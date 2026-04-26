// SPDX-License-Identifier: Apache-2.0
const express = require('express');
const promBundle = require('express-prom-bundle');
const metricsMiddleware = promBundle({includeMethod: true});

const log = require('./log');

const slack_silencer_bot = require('./slack-socket-silencer-bot');


const metricsPort = 3000;



const app = express();

// Prometheus.collectDefaultMetrics()



app.get('/', function (req, resp){
    resp.end('<a href="/metrics">/metrics</a>');
});

// Liveness probe: reports 503 when the Slack socket-mode connection has been
// down longer than the grace window. The kubelet uses this to restart the pod
// when the bot wedges (express stays up but Slack stops talking to us).
app.get('/healthz', function (req, resp){
    const health = slack_silencer_bot.getHealth();
    resp.status(health.healthy ? 200 : 503).json(health);
});

app.use(metricsMiddleware);

const server = app.listen(metricsPort, function (){
    log.info(`Prometheus Metrics http://localhost:${metricsPort}/metrics`);
});



slack_silencer_bot.init(log);


// Graceful shutdown
process.on('SIGTERM', () => {
    server.close((err) => {
        if (err){
            console.error(err);
            process.exit(1);
        }

        process.exit(0);
    });
});
