import axios from "axios";
import { getConfigVariable } from "./util.js";

export default class OpenAiService {
    #axiosInstance;
    #model = "gpt-3.5-turbo"; // Adjust model name if needed

    constructor() {
        const apiKey = getConfigVariable("OPENAI_API_KEY");
        const baseURL = getConfigVariable("OPENAI_BASE_URL");

        // Create an instance of axios with a custom base URL
        this.#axiosInstance = axios.create({
            baseURL: baseURL, // Official OpenAI base URL; adjust if using a different service
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async classify(categories, destinationName, description) {
        try {
            const prompt = this.#generatePrompt(categories, destinationName, description);

            // Use the axios instance to make a POST request to OpenAI's API
            const response = await this.#axiosInstance.post('/chat/completions', {
                model: this.#model,
                messages: [{ role: "user", content: prompt }]
            });

            // Make sure the response structure matches the actual API response
            let guess = response.data.choices[0].message.content;
            guess = guess.replace("\n", "").trim();

            if (categories.indexOf(guess) === -1) {
                console.warn(`OpenAI could not classify the transaction. 
                Prompt: ${prompt}
                OpenAI's guess: ${guess}`);
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
        return `Given I want to categorize transactions on my bank account into these categories: ${categories.join(", ")}
In which category would a transaction from "${destinationName}" with the subject "${description}" fall into?
Just output the name of the category. It does not have to be a complete sentence.`;
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
