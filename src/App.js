import express from 'express';
import { getConfigVariable } from './util.js';
import FireflyService from './FireflyService.js';
import OpenAiService from './OpenAiService.js';
import { Server } from 'socket.io';
import http from 'http';
import Queue from 'queue';
import JobList from './JobList.js';
import winston from 'winston';

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

    #logger;

    constructor() {
        this.#PORT = getConfigVariable('PORT', '3000');
        this.#ENABLE_UI = getConfigVariable('ENABLE_UI', 'false') === 'true';

        // Configure logging
        this.#logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.Console(),
            ],
        });
    }

    async run() {
        this.#firefly = new FireflyService();
        this.#openAi = new OpenAiService();

        this.#queue = new Queue({
            timeout: 30 * 1000,
            concurrency: 1,
            autostart: true
        });

        this.#queue.addEventListener('start', job => this.#logger.info('Job started', { job }));
        this.#queue.addEventListener('success', event => this.#logger.info('Job success', { job: event.job }));
        this.#queue.addEventListener('error', event => this.#logger.error('Job error', { job: event.job, error: event.err }));
        this.#queue.addEventListener('timeout', event => this.#logger.warn('Job timeout', { job: event.job }));

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
            this.#logger.info(`Application running on port ${this.#PORT}`);
        });

        this.#io.on('connection', socket => {
            this.#logger.info('Client connected');
            socket.emit('jobs', Array.from(this.#jobList.getJobs().values()));
        });
    }

    async #onWebhook(req, res) {
        try {
            this.#logger.info('Webhook triggered');
            await this.#handleWebhook(req, res);
            res.send('Queued');
        } catch (e) {
            this.#logger.error('Error handling webhook:', { error: e.message });
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
            throw new WebhookException('Trigger is not UPDATE_TRANSACTION. Request will not be processed');
        }

        if (req.body?.response !== 'TRANSACTIONS') {
            throw new WebhookException('Response is not TRANSACTIONS. Request will not be processed');
        }

        const transaction = req.body?.content?.transactions?.[0];
        if (!transaction) {
            throw new WebhookException('No transaction data available');
        }

        if (!['withdrawal', 'deposit'].includes(transaction.type)) {
            throw new WebhookException('Transaction type must be \'withdrawal\' or \'deposit\'. Transaction will be ignored.');
        }

        if (transaction.category_id !== null) {
            throw new WebhookException('Transaction category_id is already set. Transaction will be ignored.');
        }

        if (!transaction.description || !transaction.destination_name) {
            throw new WebhookException('Missing description or destination_name in transaction');
        }

        const destinationName = transaction.destination_name;
        const description = transaction.description;
        const cleanedDescription = removeSubstrings(description, exactSubstringsToRemove);

        const job = this.#jobList.createJob({
            destinationName,
            description: cleanedDescription
        });

        await this.#queue.push(async () => {
            this.#jobList.setJobInProgress(job.id);

            try {
                const categories = await this.#firefly.getCategories();
                const classificationResult = await this.#openAi.classify(
                    Array.from(categories.keys()), 
                    destinationName, 
                    cleanedDescription
                );

                if (!classificationResult || typeof classificationResult !== 'object') {
                    throw new Error('Invalid classification result');
                }

                const { category, prompt, response } = classificationResult;

                const newData = {
                    ...job.data,
                    category,
                    prompt,
                    response
                };

                this.#jobList.updateJobData(job.id, newData);

                if (!category) {
                    this.#logger.info('Requesting category input for job:', { jobId: job.id });
                    this.#io.emit('request-category-input', {
                        transactionId: req.body.content.id,
                        description: cleanedDescription,
                        prompt,
                        categories: Array.from(categories.keys())
                    });
                } else {
                    this.#logger.info('Setting category for job:', { jobId: job.id });
                    await this.#firefly.setCategory(req.body.content.id, job.data.transactions, categories.get(category));
                }

                this.#jobList.setJobFinished(job.id);
            } catch (e) {
                this.#logger.error('Error processing job:', { jobId: job.id, error: e.message });
                this.#jobList.setJobFailed(job.id);
            }
        });
    }

    async #onCategoryInput(req, res) {
        try {
            const { transactionId, category } = req.body;

            if (!transactionId || !category) {
                throw new Error('Transaction ID and category are required.');
            }

            this.#logger.info('Handling category input:', { transactionId, category });
            await this.#handleCategoryInput(transactionId, category);
            res.send('Category recorded.');
        } catch (e) {
            this.#logger.error('Error handling category input:', { error: e.message });
            res.status(400).send(e.message);
        }
    }

    async #handleCategoryInput(transactionId, category) {
        const categories = await this.#firefly.getCategories();
        const categoryId = categories.get(category);

        if (!categoryId) {
            throw new Error('Invalid category.');
        }

        await this.#firefly.setCategory(transactionId, [], categoryId); // Assuming the transactions array is empty or managed separately
    }
}

class WebhookException extends Error {
    constructor(message) {
        super(message);
        this.name = 'WebhookException';
    }
}
