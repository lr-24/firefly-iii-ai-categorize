import { Configuration, OpenAIApi } from "openai";
import { getConfigVariable } from "./util.js";

export default class OpenAiService {
    #openAi;
    #model = "gpt-3.5-turbo"; // Adjust model name if needed

    constructor() {
        const apiKey = getConfigVariable("OPENAI_API_KEY");
        const baseURL = getConfigVariable("BASE_URL"); // Correct variable name

        const configuration = new Configuration({
            apiKey,
            baseURL // Correct variable name
        });

        this.#openAi = new OpenAIApi(configuration);
    }

    async classify(categories, destinationName, description) {
        try {
            const prompt = this.#generatePrompt(categories, destinationName, description);

            // Use createCompletion or createChatCompletion based on model
            const response = await this.#openAi.createChatCompletion({
                model: this.#model,
                messages: [{ role: "user", content: prompt }]
            });

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
