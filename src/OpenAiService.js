import axios from "axios";
import { getConfigVariable } from "./util.js";

export default class OpenAiService {
    #axiosInstance;
    #model = "gpt-3.5-turbo"; // Modifica il nome del modello se necessario

    constructor() {
        const apiKey = getConfigVariable("OPENAI_API_KEY");
        const baseURL = getConfigVariable("OPENAI_BASE_URL")

        if (!apiKey) {
            throw new Error("API key is not defined in the configuration.");
        }

        this.#axiosInstance = axios.create({
            baseURL: baseURL, // Imposta l'URL di base personalizzato
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async classify(categories, destinationName, description) {
        try {
            const prompt = this.#generatePrompt(categories, destinationName, description);

            // Esegui una richiesta POST all'endpoint appropriato
            const response = await this.#axiosInstance.post('/chat/completions', { // Verifica l'endpoint
                model: this.#model,
                messages: [{ role: "user", content: prompt }]
            });

            // Assicurati che la struttura della risposta sia corretta
            const guess = response.data.choices[0]?.message?.content?.trim() || '';
            if (categories.indexOf(guess) === -1) {
                console.warn(`OpenAI could not classify the transaction.\nPrompt: ${prompt}\nOpenAI's guess: ${guess}`);
                return null;
            }

            return {
                prompt,
                response: guess,
                category: guess
            };

        } catch (error) {
            if (error.response) {
                console.error(error.response.status);
                console.error(error.response.data);
                throw new OpenAiException(error.response.status, error.response, error.response.data);
            } else {
                console.error(error.message);
                throw new OpenAiException(null, null, error.message);
            }
        }
    }

    #generatePrompt(categories, destinationName, description) {
        return `Sei un esperto di transazioni bancarie e hai a disposizione tutta la conoscenza di internet. Dato che voglio categorizzare le transazioni sul mio conto bancario in queste categorie: ${categories.join(", ")}
In quale categoria rientrerebbe una transazione dal "${destinationName}"  con la descrizione "${description}"?
Restituisci solo il nome della categoria. Non è necessario che sia una frase completa.`;
    }
}

class OpenAiException extends Error {
    code;
    response;
    body;

    constructor(statusCode, response, body) {
        super(`Error while communicating with OpenAI: ${statusCode} - ${body}`);
        this.code = statusCode;
        this.response = response;
        this.body = body;
    }
}
