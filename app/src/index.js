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

// Always-200 endpoint for kubelet liveness. We deliberately do NOT couple
// liveness to Slack connectivity: a Slack outage would otherwise restart
// every silencer pod on the planet in a tight loop.
app.get('/livez', function (req, resp){
    resp.status(200).json({alive: true});
});

// Readiness/health endpoint: 503 when the Slack socket-mode connection has
// been down longer than the grace window. Use this for readiness so the
// pod is removed from the Service while disconnected, but do not use it
// for liveness.
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
