import {getConfigVariable} from "./util.js";

export default class FireflyService {
    #BASE_URL;
    #PERSONAL_TOKEN;

    constructor() {
        this.#BASE_URL = getConfigVariable("FIREFLY_URL")
        if (this.#BASE_URL.slice(-1) === "/") {
            this.#BASE_URL = this.#BASE_URL.substring(0, this.#BASE_URL.length - 1)
        }

        this.#PERSONAL_TOKEN = getConfigVariable("FIREFLY_PERSONAL_TOKEN")
    }

    async getCategories() {
        const response = await fetch(`${this.#BASE_URL}/api/v1/categories`, {
            headers: {
                Authorization: `Bearer ${this.#PERSONAL_TOKEN}`,
            }
        });

        if (!response.ok) {
            throw new FireflyException(response.status, response, await response.text())
        }

        const data = await response.json();

        const categories = new Map();
        data.data.forEach(category => {
            categories.set(category.attributes.name, category.id);
        });

        return categories;
    }

    async setCategory(transactionId, transactions, categoryId, customTag = null) {
        const tag = customTag || getConfigVariable("FIREFLY_TAG_AI", "AI categorized");

        const body = {
            apply_rules: true,
            fire_webhooks: true,
            transactions: [],
        }

        transactions.forEach(transaction => {
            let tags = transaction.tags;
            if (!tags) {
                tags = [];
            }
            tags.push(tag);

            body.transactions.push({
                transaction_journal_id: transaction.transaction_journal_id,
                category_id: categoryId,
                tags: tags,
            });
        })

        const response = await fetch(`${this.#BASE_URL}/api/v1/transactions/${transactionId}`, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${this.#PERSONAL_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new FireflyException(response.status, response, await response.text())
        }

        await response.json();
        console.info("Transaction updated")
    }

    /**
     * Makes Firefly run its rules (apply_rules=true) on a transaction whose category was already saved,
     * without changing the category or the tags.
     * Used by "Do not change": the temporary AI category is saved with apply_rules=false, so rules that
     * depend on the category (for example "add tag <macro-category>") have never run.
     * The current category and tags are read from Firefly right now (not from the old webhook payload),
     * so anything changed in the meantime (by the user or by other rules) is preserved.
     * Returns false if the transaction no longer exists or has no category.
     */
    async applyRules(transactionId) {
        const getResponse = await fetch(`${this.#BASE_URL}/api/v1/transactions/${transactionId}`, {
            headers: {
                Authorization: `Bearer ${this.#PERSONAL_TOKEN}`,
            }
        });

        if (getResponse.status === 404) {
            console.warn(`Transaction ${transactionId} not found: rules not applied`);
            return false;
        }

        if (!getResponse.ok) {
            throw new FireflyException(getResponse.status, getResponse, await getResponse.text())
        }

        const current = (await getResponse.json()).data.attributes.transactions;

        const body = {
            apply_rules: true,
            fire_webhooks: true,
            transactions: [],
        }

        current.forEach(transaction => {
            if (transaction.category_id === null || transaction.category_id === undefined || transaction.category_id === '') {
                return; // the category was removed in the meantime: nothing to confirm for this split
            }

            body.transactions.push({
                transaction_journal_id: transaction.transaction_journal_id,
                category_id: transaction.category_id,
                tags: transaction.tags ?? [],
            });
        });

        if (body.transactions.length === 0) {
            console.warn(`Transaction ${transactionId} has no category: rules not applied`);
            return false;
        }

        const response = await fetch(`${this.#BASE_URL}/api/v1/transactions/${transactionId}`, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${this.#PERSONAL_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new FireflyException(response.status, response, await response.text())
        }

        await response.json();
        console.info("Rules applied to transaction")
        return true;
    }

    async setTempCategory(transactionId, transactions, categoryId, customTag = null) {
        const tag = customTag || getConfigVariable("FIREFLY_TAG_AI", "AI categorized");

        const body = {
            apply_rules: false, //it will not apply TAGS
            fire_webhooks: true,
            transactions: [],
        }

        transactions.forEach(transaction => {
            let tags = transaction.tags;
            if (!tags) {
                tags = [];
            }
            tags.push(tag);

            body.transactions.push({
                transaction_journal_id: transaction.transaction_journal_id,
                category_id: categoryId,
                tags: tags,
            });
        })

        const response = await fetch(`${this.#BASE_URL}/api/v1/transactions/${transactionId}`, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${this.#PERSONAL_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new FireflyException(response.status, response, await response.text())
        }

        await response.json();
        console.info("Transaction updated")
    }
}

class FireflyException extends Error {
    code;
    response;
    body;

    constructor(statusCode, response, body) {
        super(`Error while communicating with Firefly III: ${statusCode} - ${body}`);

        this.code = statusCode;
        this.response = response;
        this.body = body;
    }
}
