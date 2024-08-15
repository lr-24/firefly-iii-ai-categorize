import express from "express";
import { getConfigVariable } from "./util.js";
import FireflyService from "./FireflyService.js";
import OpenAiService from "./OpenAiService.js";
import { Server } from "socket.io";
import * as http from "http";
import Queue from "queue";
import JobList from "./JobList.js";

export default class App {
    #PORT;
    #ENABLE_UI;

    #firefly;
    #openAi;

    #server;
    #io;
    #express;

    #queue;
    #jobList;

    constructor() {
        this.#PORT = getConfigVariable("PORT", '3000');
        this.#ENABLE_UI = getConfigVariable("ENABLE_UI", 'false') === 'true';
    }

    async run() {
        this.#firefly = new FireflyService();
        this.#openAi = new OpenAiService();

        this.#queue = new Queue({
            timeout: 30 * 1000,
            concurrency: 1,
            autostart: true
        });

        this.#queue.addEventListener('start', job => console.log('Job started', job));
        this.#queue.addEventListener('success', event => console.log('Job success', event.job));
        this.#queue.addEventListener('error', event => console.error('Job error', event.job, event.err, event));
        this.#queue.addEventListener('timeout', event => console.log('Job timeout', event.job));

        this.#express = express();
        this.#server = http.createServer(this.#express);
        this.#io = new Server(this.#server);

        this.#jobList = new JobList();
        this.#jobList.on('job created', data => this.#io.emit('job created', data));
        this.#jobList.on('job updated', data => this.#io.emit('job updated', data));

        this.#express.use(express.json());

        if (this.#ENABLE_UI) {
            this.#express.use('/', express.static('public'));
        }

        this.#express.post('/webhook', this.#onWebhook.bind(this));

        this.#express.post('/set-category', async (req, res) => {
            try {
                const { jobId, categoryId } = req.body;
                await this.setCategory(jobId, categoryId);
                res.sendStatus(200);
            } catch (error) {
                console.error('Error setting category:', error);
                res.status(400).send(error.message);
            }
        });

        this.#server.listen(this.#PORT, () => {
            console.log(`Application running on port ${this.#PORT}`);
        });

        this.#io.on('connection', socket => {
            console.log('connected');
            socket.emit('jobs', Array.from(this.#jobList.getJobs().values()));
        });
    }

    #onWebhook(req, res) {
        try {
            console.info("Webhook triggered");
            this.#handleWebhook(req, res);
            res.send("Queued");
        } catch (e) {
            console.error(e);
            res.status(400).send(e.message);
        }
    }

    #handleWebhook(req, res) {
        const exactSubstringsToRemove = [
            /PAGAMENTO POS\b/i,
            /CRV\*/i,
            /VILNIUS IRL.*$/i,
            /DUBLIN IRL.*$/i,
            /OPERAZIONE.*$/i
        ];

        function removeSubstrings(description, regexPatterns) {
            let result = description;
            regexPatterns.forEach(pattern => {
                result = result.replace(pattern, '');
            });
            return result.trim();
        }

        // Validate request
        if (req.body?.trigger !== "UPDATE_TRANSACTION") {
            throw new WebhookException("trigger is not UPDATE_TRANSACTION. Request will not be processed");
        }

        if (req.body?.response !== "TRANSACTIONS") {
            throw new WebhookException("response is not TRANSACTIONS. Request will not be processed");
        }

        if (!req.body?.content?.id) {
            throw new WebhookException("Missing content.id");
        }

        if (req.body?.content?.transactions?.length === 0) {
            throw new WebhookException("No transactions are available in content.transactions");
        }

        if (!["withdrawal", "deposit"].includes(req.body.content.transactions[0].type)) {
            throw new WebhookException("content.transactions[0].type must be 'withdrawal' or 'deposit'. Transaction will be ignored.");
        }

        if (req.body.content.transactions[0].category_id !== null) {
            throw new WebhookException("content.transactions[0].category_id is already set. Transaction will be ignored.");
        }

        if (!req.body.content.transactions[0].description) {
            throw new WebhookException("Missing content.transactions[0].description");
        }

        if (!req.body.content.transactions[0].destination_name) {
            throw new WebhookException("Missing content.transactions[0].destination_name");
        }

        const destinationName = req.body.content.transactions[0].destination_name;
        const description = req.body.content.transactions[0].description;

        const cleanedDescription = removeSubstrings(description, exactSubstringsToRemove);

        const job = this.#jobList.createJob({
            destinationName,
            description: cleanedDescription,
            transactionId: req.body.content.id,
            transactions: req.body.content.transactions
        });

        this.#queue.push(async () => {
            this.#jobList.setJobInProgress(job.id);

            const categories = await this.#firefly.getCategories();

            const { category, prompt, response } = await this.#openAi.classify(Array.from(categories.keys()), destinationName, cleanedDescription);

            const newData = {
                ...job.data,
                category,
                prompt,
                response,
                categories: Array.from(categories.entries())
            };

            this.#jobList.updateJobData(job.id, newData);

            if (category) {
                await this.#firefly.setCategory(req.body.content.id, req.body.content.transactions, categories.get(category));
                this.#jobList.setJobFinished(job.id);
            } else {
                this.#jobList.setJobHumanInput(job.id);
            }
        });
    }

    async setCategory(jobId, categoryId) {
        const job = this.#jobList.getJob(jobId);
        if (!job || job.status !== 'human-input') {
            throw new Error('Invalid job or job status');
        }

        await this.#firefly.setCategory(job.data.transactionId, job.data.transactions, categoryId);
        this.#jobList.setJobFinished(jobId);
    }
}

class WebhookException extends Error {
    constructor(message) {
        super(message);
    }
}
