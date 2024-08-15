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
        // Define the list of regex patterns to remove
        const exactSubstringsToRemove = [
            /PAGAMENTO POS\b/i, // Exact match for 'PAGAMENTO POS'
            /VILNIUS IRL.*$/i, // Remove 'VILNIUS IRL' and everything following it
            /DUBLIN IRL.*$/i, // Remove 'DUBLIN IRL' and everything following it
            /OPERAZIONE.*$/i // Remove 'OPERAZIONE' and everything following it
        ];

        // Helper function to remove specific substrings using regex patterns
        function removeSubstrings(description, regexPatterns) {
            let result = description;

            // Apply each regex pattern to remove substrings
            regexPatterns.forEach(pattern => {
                result = result.replace(pattern, '');
            });

            return result.trim(); // Trim any extra spaces from the result
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

        // Remove specific substrings from the description
        const cleanedDescription = removeSubstrings(description, exactSubstringsToRemove);

        const job = this.#jobList.createJob({
            destinationName,
            description: cleanedDescription
        });

        this.#queue.push(async () => {
            this.#jobList.setJobInProgress(job.id);

            const categories = await this.#firefly.getCategories();

            const { category, prompt, response } = await this.#openAi.classify(Array.from(categories.keys()), destinationName, cleanedDescription);

            const newData = {
                ...job.data,
                category,
                prompt,
                response
            };

            this.#jobList.updateJobData(job.id, newData);

            if (category) {
                await this.#firefly.setCategory(req.body.content.id, req.body.content.transactions, categories.get(category));
            }

            this.#jobList.setJobFinished(job.id);
        });
    }
}

class WebhookException extends Error {
    constructor(message) {
        super(message);
    }
}
