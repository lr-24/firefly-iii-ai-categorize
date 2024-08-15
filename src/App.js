import express from 'express';
import { getConfigVariable } from './util.js';
import FireflyService from './FireflyService.js';
import OpenAiService from './OpenAiService.js';
import { Server } from 'socket.io';
import http from 'http';
import Queue from 'queue';
import JobList from './JobList.js';

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
        this.#PORT = getConfigVariable('PORT', '3000');
        this.#ENABLE_UI = getConfigVariable('ENABLE_UI', 'false') === 'true';
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
        this.#express.post('/category_input', this.#onCategoryInput.bind(this));

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
            console.info('Webhook triggered');
            this.#handleWebhook(req, res);
            res.send('Queued');
        } catch (e) {
            console.error(e);
            res.status(400).send(e.message);
        }
    }

    async #handleWebhook(req, res) {
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

        if (req.body?.trigger !== 'UPDATE_TRANSACTION') {
            throw new WebhookException('Trigger is not UPDATE_TRANSACTION. Request will not be processed.');
        }

        if (req.body?.response !== 'TRANSACTIONS') {
            throw new WebhookException('Response is not TRANSACTIONS. Request will not be processed.');
        }

        if (!req.body?.content?.id) {
            throw new WebhookException('Missing content.id');
        }

        if (!req.body?.content?.transactions || req.body.content.transactions.length === 0) {
            throw new WebhookException('No transactions are available in content.transactions');
        }

        const transaction = req.body.content.transactions[0];

        if (!['withdrawal', 'deposit'].includes(transaction.type)) {
            throw new WebhookException('content.transactions[0].type must be "withdrawal" or "deposit". Transaction will be ignored.');
        }

        if (transaction.category_id !== null) {
            throw new WebhookException('content.transactions[0].category_id is already set. Transaction will be ignored.');
        }

        if (!transaction.description) {
            throw new WebhookException('Missing content.transactions[0].description');
        }

        if (!transaction.destination_name) {
            throw new WebhookException('Missing content.transactions[0].destination_name');
        }

        const destinationName = transaction.destination_name;
        const description = transaction.description;
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

            if (!category) {
                this.#io.emit('request-category-input', {
                    transactionId: req.body.content.id,
                    description: cleanedDescription,
                    prompt,
                    categories: Array.from(categories.keys())
                });
            } else {
                await this.#firefly.setCategory(req.body.content.id, req.body.content.transactions, categories.get(category));
            }

            this.#jobList.setJobFinished(job.id);
        });
    }

    #onCategoryInput(req, res) {
        try {
            const { transactionId, categoryId } = req.body;

            if (!transactionId || !categoryId) {
                throw new Error('Transaction ID and category ID are required.');
            }

            // Process and store the user-provided category
            this.#handleCategoryInput(transactionId, categoryId);

            res.send('Category recorded.');
        } catch (e) {
            console.error(e);
            res.status(400).send(e.message);
        }
    }

    #handleCategoryInput(transactionId, categoryId) {
        // Fetch the transactions list to pass to setCategory
        const transactions = this.#jobList.getJobById(transactionId)?.transactions;

        if (!transactions) {
            throw new Error('Transactions not found for the given transaction ID.');
        }

        // Call setCategory with the appropriate arguments
        this.#firefly.setCategory(transactionId, transactions, categoryId);
    }
}

class WebhookException extends Error {
    constructor(message) {
        super(message);
        this.name = 'WebhookException'; // Add a name to the error
    }
}
