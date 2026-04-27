// SPDX-License-Identifier: Apache-2.0
const slackAppToken = process.env.SLACK_APP_TOKEN;
const slackBotToken = process.env.SLACK_BOT_TOKEN;


const {App} = require('@slack/bolt');
const RJSON = require('relaxed-json');
const moment = require('moment-timezone');
const request = require('request');

const regExpSlackMessage = /s(ilence)?(\s*for)?\s?((?<year>\d+)\s*y(ear)*s*)?\s?((?<month>\d+)\s*mo(nth)*s*)?\s?((?<week>\d+)\s*w(eek)*s*)?\s?((?<day>\d+)\s*d(ay)*s*)?\s?((?<hour>\d+)\s*h(our)*s*)?\s?((?<minute>\d+)\s*m(inute)*s*)?/;
const silencesPath = '/api/v2/silences';
const silencePath = '/api/v2/silence';

const app = new App({
    token: slackBotToken,
    appToken: slackAppToken,
    socketMode: true,
});

// Disconnections shorter than this are tolerated (normal reconnect blips).
// Beyond this, /healthz returns 503 so the kubelet readiness probe can pull us
// out of the Service. Liveness uses /livez (always 200) on purpose.
const HEALTH_GRACE_MS = 60_000;

const connectionState = {
    isConnected: false,
    lastStateChange: Date.now(),
};

function getHealth(){
    const now = Date.now();
    const downtimeMs = connectionState.isConnected ? 0 : now - connectionState.lastStateChange;
    return {
        healthy: connectionState.isConnected || downtimeMs < HEALTH_GRACE_MS,
        isConnected: connectionState.isConnected,
        lastStateChange: connectionState.lastStateChange,
        downtimeMs,
    };
}

function setConnected(log, connected, reason){
    if (connectionState.isConnected === connected) return;
    connectionState.isConnected = connected;
    connectionState.lastStateChange = Date.now();
    log.info(`SlackBot Silencer : socket-mode ${connected ? 'connected' : 'disconnected'}${reason ? ` (${reason})` : ''}`);
}


function findAlertMessageFilter(log, messages){
    if (messages.length > 0){
        const msg = messages[0]; // pick first message(threads) / prev message (for channel)
        if (msg.text === '' && typeof msg.attachments !== 'undefined' && msg.attachments.length > 0){ // text="", attachement contains firing info
            let attachment = msg.attachments[0];
            // The Alertmanager URL and the silence filter are both derived from
            // the "Silence" action button URL. Some alert templates intentionally
            // omit that button (e.g. infrastructure alerts that aren't meant to
            // be silenced via chat). Treat those as "no alert here" instead of
            // crashing the bolt handler.
            if (!Array.isArray(attachment.actions) || attachment.actions.length === 0){
                log.debug('SlackBot Silencer : attachment has no actions array');
                return null;
            }
            let silence = attachment.actions.find(f => f && typeof f.text === 'string' && f.text.toLowerCase().indexOf('silence ') >= 0);
            if (!silence || typeof silence.url !== 'string'){
                log.debug(`SlackBot Silencer : no Silence button on alert "${attachment.title}" — cannot derive Alertmanager URL or filter`);
                return null;
            }
            let url = decodeURIComponent(silence.url);
            let text = url.substring(url.indexOf('filter=') + 'filter='.length);
            let replaced = text.replace(/=/i, ':');
            while (replaced.indexOf('=') >= 0){
                replaced = replaced.replace(/=/i, ':');
            }
            let parsedURL = new URL(url);
            // Use origin (drops the trailing ':' when port is empty) and force HTTPS:
            // Alertmanager ingress 308-redirects http→https, but the legacy `request`
            // library downgrades POST to GET on redirect, silently turning a
            // "create silence" call into "list silences" with status 200.
            let amUrl = parsedURL.origin.replace(/^http:\/\//, 'https://');
            return {
                filter: RJSON.parse(replaced),
                url: amUrl,
                alerting: attachment.title.indexOf('FIRING') >= 0,
                resolved: attachment.title.indexOf('RESOLVED') >= 0
            };
        }
    }
    log.debug('SlackBot Silencer : message does not contains required attachments');
    return null;
}

async function silenceAlert(log, url, filter, owner, startsAt, endsAt){
    let postData = {
        startsAt: startsAt,
        endsAt: endsAt,
        createdBy: owner,
        comment: 'Silenced by SilencerBot slack message',
        matchers: []
    };

    const keys = Object.keys(filter);
    for (const fk of keys){
        const fv = filter[fk];
        postData.matchers.push({
            name: fk, value: fv, isRegex: false
        });
    }
    log.info(`SlackBot Silencer : ${url + silencesPath} postData : ${JSON.stringify(postData)}`);
    return new Promise((resolve, reject) => {
        request({
            url: url + silencesPath,
            method: 'POST',
            body: JSON.stringify(postData),
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            followAllRedirects: true,
            jar: true,
        }, function (error, response, body){
            if (error){
                reject(error);
            } else if (response && response.statusCode === 200){
                resolve(JSON.parse(body));
            } else {
                reject(response);
            }
        });
    });
}

async function getAlertData(log, event, client){
    //reply in thread
    if (typeof event['thread_ts'] !== 'undefined'){
        const response = await client.apiCall('conversations.replies', {
            channel: event.channel,
            ts: event.thread_ts,
            latest: event.ts,
            limit: 1,
            inclusive: false
        });

        if (response.ok === true){
            return new Promise((resolve) => {
                resolve(findAlertMessageFilter(log, response.messages));
            });
        } else {
            return Promise.reject(`Error from conversations.replies : ${JSON.stringify(response)}`);
        }
    } else if (event['channel_type'] && event['channel_type'] === 'channel'){

        //Channel Message - search for last alert in recent history
        const response = await client.apiCall('conversations.history', {
            channel: event.channel,
            latest: event.ts,
            limit: 20,  // Search last 20 messages
            inclusive: false
        });
        if (response.ok === true){
            // Search through messages to find the last alert
            for (const message of response.messages) {
                const alertData = findAlertMessageFilter(log, [message]);
                if (alertData !== null) {
                    log.info(`Found alert in channel history at position ${response.messages.indexOf(message)}`);
                    return Promise.resolve(alertData);
                }
            }
            log.debug('SlackBot Silencer : No alert message found in recent channel history');
            return Promise.resolve(null);
        } else {
            return Promise.reject(`Error from conversations.history : ${JSON.stringify(response)}`);
        }
    }
    return Promise.reject('Unknown event message');

}

function extractMessageAction(log, event){
    if (event.type === 'message'
            && typeof event.text === 'string'
            && typeof event.bot_id !== 'string'
    ){

        if (event.text.toLowerCase().indexOf('check') >= 0){
            return {type: 'CHECK'};
        } else if (event.text.toLowerCase().indexOf('expire') >= 0){
            return {type: 'EXPIRE'};
        } else if (event.text.toLowerCase().indexOf('s') >= 0
                && event.text.toLowerCase().match(regExpSlackMessage) != null){

            const silencePeriods = [];

            let text = event.text.toLowerCase();
            let match = text.match(regExpSlackMessage);

            log.debug(`Parsed silence periods - years: ${match.groups['year']}, months: ${match.groups['month']}, weeks: ${match.groups['week']}, days: ${match.groups['day']}, hours: ${match.groups['hour']}, minutes: ${match.groups['minute']}`);

            if (match.groups['year'] !== undefined){
                silencePeriods.push({
                    value: match.groups['year'],
                    unit: 'years'
                });
            }
            if (match.groups['month'] !== undefined){
                silencePeriods.push({
                    value: match.groups['month'],
                    unit: 'months'
                });
            }
            if (match.groups['week'] !== undefined){
                silencePeriods.push({
                    value: match.groups['week'],
                    unit: 'weeks'
                });
            }
            if (match.groups['day'] !== undefined){
                silencePeriods.push({
                    value: match.groups['day'],
                    unit: 'days'
                });
            }
            if (match.groups['hour'] !== undefined){
                silencePeriods.push({
                    value: match.groups['hour'],
                    unit: 'hours'
                });
            }
            if (match.groups['minute'] !== undefined){
                silencePeriods.push({
                    value: match.groups['minute'],
                    unit: 'minutes'
                });
            }

            return {type: 'SILENCE', silencePeriods};
        }
    }
    return null;
}

async function getUserName(log, client, userId){
    const userResponse = await client.apiCall('users.info', {
        user: userId
    });
    return new Promise(resolve => resolve(userResponse.user.name));
}

async function getSilencesForFilter(log, url, filter){
    const keys = Object.keys(filter);

    var urlPath = '';

    for (const fk of keys){
        const fv = filter[fk];
        urlPath += encodeURI(`filter=${fk}="${fv}"`) + '&';
    }
    urlPath += 'silenced=false&inhibited=false&active=true';
    // console.log(`${url}${silencesPath}?${urlPath}`)
    return new Promise((resolve, reject) => {
        request({
            url: `${url}${silencesPath}?${urlPath}`,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            followAllRedirects: true,
            jar: true,
        }, function (error, response, body){
            if (error){
                reject(error);
            } else if (response && response.statusCode === 200){
                const result = JSON.parse(body).filter(i => {
                    return i.status.state === 'active';
                });
                resolve(result);
            }
        });
    });


}

async function deleteSilence(log, url, id){

    return new Promise((resolve, reject) => {
        request({
            url: `${url}${silencePath}/${id}`,
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            followAllRedirects: true,
            jar: true,
        }, function (error, response){
            if (error){
                reject(error);
            } else if (response && response.statusCode === 200){
                resolve();
            }
        });
    });
}

function getFilterMessage(filterData){
    var message = '';

    const keys = Object.keys(filterData);
    for (const fk of keys){
        const fv = filterData[fk];
        message += `• *${fk}*=\`${fv}\`\n`;
    }

    return message;
}

function getTextDuration(endsAtStr, nowStr){

    var endsAt = moment(endsAtStr).tz('UTC');
    var now = moment(nowStr).tz('UTC');

    const days = endsAt.diff(now, 'days');
    const hours = endsAt.diff(now, 'hours') % 24;
    const minutes = endsAt.diff(now, 'minutes') % 60;

    var message = '*';
    if (days > 0){
        if (days === 1){
            message += `${days} day`;
        } else {
            message += `${days} days`;
        }
    }

    if (hours > 0){
        message += ' ';
    }
    if (hours > 0){
        if (hours === 1){
            message += `${hours} hour`;
        } else {
            message += `${hours} hours`;
        }
    }
    if (minutes > 0){
        message += ' ';
    }
    if (minutes > 0){
        if (minutes === 1){
            message += `${minutes} minute`;
        } else {
            message += `${minutes} minutes`;
        }
    }
    message += '*';
    return message;
}

function replyWithCurrentSilences(alertData, silences, client, event, now){
    var message = `AlertData:\n${getFilterMessage(alertData.filter)}*Already Silenced*\n`;
    for (const silence of silences){
        message += `\n• *ID*=${silence.id} for ${getTextDuration(silence.endsAt, now)}`;
    }
    // Add timestamp to make message unique and avoid Slack deduplication
    message += `\n_Checked at ${moment().format('HH:mm:ss')}_`;

    client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts,
        text: message,
    }).then(() => {
        console.log('Successfully posted silence status message');
    }).catch((error) => {
        console.error('Error posting message:', error);
    });
}

function replyNoActiveSilences(client, event, alertData){
    const message = `AlertData:\n${getFilterMessage(alertData.filter)}*NO Active Silences*\n_Checked at ${moment().format('HH:mm:ss')}_`;
    
    client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts,
        text: message,
    }).then(() => {
        console.log('Successfully posted no-silences message');
    }).catch((error) => {
        console.error('Error posting message:', error);
    });
}

function init(log){


    app.message(/.*/, async ({event, client}) => {

        log.info('received slack event : ' + JSON.stringify(event));
        log.info(`Processing message from user ${event.user} at ${event.ts}: "${event.text}"`);

        const now = moment().tz('UTC').format();

        const messageAction = extractMessageAction(log, event);
        log.info('messageAction: ' + JSON.stringify(messageAction));
        if (messageAction != null){
            const alertData = await getAlertData(log, event, client);
            if (alertData != null){
                log.info(`Silencer: ${JSON.stringify(alertData)}`);

                if (messageAction.type === 'CHECK'){
                    const silences = await getSilencesForFilter(log, alertData.url, alertData.filter);
                    log.info(`Silences : ${JSON.stringify(silences)}`);

                    if (silences.length > 0){
                        replyWithCurrentSilences(alertData, silences, client, event, now);
                    } else {
                        replyNoActiveSilences(client, event, alertData);
                    }
                } else if (messageAction.type === 'EXPIRE'){
                    const silences = await getSilencesForFilter(log, alertData.url, alertData.filter);
                    if (silences.length > 0){

                        for (const silence of silences){
                            await deleteSilence(log, alertData.url, silence.id);
                            log.info(`Silencer: Deleted Silence ${silence.id}`);
                        }

                        var message = `AlertData:\n${getFilterMessage(alertData.filter)}*Silence Deleted*`;
                        for (const silence of silences){
                            message += `\n• ID=${silence.id}`;
                        }
                        client.chat.postMessage({
                            channel: event.channel,
                            thread_ts: event.thread_ts,
                            text: message,
                        });
                    } else {
                        replyNoActiveSilences(client, event, alertData);
                    }
                } else if (messageAction.type === 'SILENCE'){
                    const silences = await getSilencesForFilter(log, alertData.url, alertData.filter);

                    if (silences.length > 0){
                        replyWithCurrentSilences(alertData, silences, client, event, now);
                    } else {
                        if (alertData.resolved === true){
                            client.chat.postMessage({
                                channel: event.channel,
                                thread_ts: event.thread_ts,
                                text: `Alert : *${alertData.alertname}*\n${getFilterMessage(alertData.filter)}*Already Resolved*`,
                            });
                        } else if (alertData.alerting === true){
                            const userName = await getUserName(log, client, event.user);

                            const startsAt = moment(now).tz('UTC').format();
                            var endsAtMoment = moment(now).tz('UTC');

                            // If no silence periods specified, default to 1 hour
                            if (messageAction.silencePeriods.length === 0){
                                log.info('No silence duration specified, defaulting to 1 hour');
                                endsAtMoment.add(1, 'hours');
                            } else {
                                log.info(`Applying silence periods: ${JSON.stringify(messageAction.silencePeriods)}`);
                                for (const period of messageAction.silencePeriods){
                                    endsAtMoment.add(period.value, period.unit);
                                }
                            }

                            const endsAt = endsAtMoment.format();
                            log.info(`Silence duration: from ${startsAt} to ${endsAt}`);

                            try {
                                const silenceResponse = await silenceAlert(log, alertData.url, alertData.filter, userName, startsAt, endsAt);
                                log.info(`Silence Response: ${JSON.stringify(silenceResponse)}`);

                                // Alertmanager API returns different formats:
                                // - Some versions return {silenceID: "..."}
                                // - Some versions return an array of all silences
                                let silenceID = null;

                                if (silenceResponse != null){
                                    if (silenceResponse.silenceID){
                                        // Direct silenceID field
                                        silenceID = silenceResponse.silenceID;
                                    } else if (silenceResponse.id){
                                        // Direct id field
                                        silenceID = silenceResponse.id;
                                    } else if (Array.isArray(silenceResponse) && silenceResponse.length > 0){
                                        // Response is an array - find the most recently created silence
                                        // Sort by updatedAt descending and take the first one
                                        const sortedSilences = silenceResponse
                                            .filter(s => s.createdBy === userName && s.comment === 'Silenced by SilencerBot slack message')
                                            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

                                        if (sortedSilences.length > 0){
                                            silenceID = sortedSilences[0].id;
                                            log.info(`Found silence ID from array response: ${silenceID}`);
                                        }
                                    }
                                }

                                if (silenceID){
                                    client.chat.postMessage({
                                        channel: event.channel,
                                        thread_ts: event.thread_ts,
                                        text: `Alert : *${alertData.filter.alertname}* has been silenced(id=${silenceID})\n${getFilterMessage(alertData.filter)}\n *Silenced* for ${getTextDuration(endsAt, now)}`,
                                    });
                                } else {
                                    log.error(`Unexpected silence response format: ${JSON.stringify(silenceResponse)}`);
                                    client.chat.postMessage({
                                        channel: event.channel,
                                        thread_ts: event.thread_ts,
                                        text: 'Silence may have been created, but could not retrieve silence ID. Please check Alertmanager.',
                                    });
                                }
                            } catch (error) {
                                log.error(`Failed to create silence: ${JSON.stringify(error)}`);
                                client.chat.postMessage({
                                    channel: event.channel,
                                    thread_ts: event.thread_ts,
                                    text: 'Failed to create silence. Please check Alertmanager connectivity.',
                                });
                            }
                        }
                    }
                }
            }
        }

    });

    // app.event('app_mention', async ({event, client, context}) => {
    //     log.info('mention ', event)
    // });

    const socketClient = app.receiver && app.receiver.client;
    if (socketClient && typeof socketClient.on === 'function'){
        socketClient.on('connected', () => setConnected(log, true));
        socketClient.on('disconnected', (err) => setConnected(log, false, err && err.message ? err.message : undefined));
        socketClient.on('unable_to_socket_mode_start', (err) => {
            setConnected(log, false, `unable_to_socket_mode_start: ${err && err.message ? err.message : err}`);
        });
        socketClient.on('error', (err) => {
            log.warn(`SlackBot Silencer : socket-mode error: ${err && err.message ? err.message : err}`);
        });
    } else {
        log.warn('SlackBot Silencer : could not attach socket-mode listeners (receiver.client unavailable)');
    }

    (async () => {
        try {
            await app.start();
            log.info('Slack Silencer started');
        } catch (err) {
            log.error(`SlackBot Silencer : app.start() failed: ${err && err.stack ? err.stack : err}`);
            setConnected(log, false, 'app.start() rejected');
        }
    })();

}


module.exports = {
    init,
    getHealth,
};
