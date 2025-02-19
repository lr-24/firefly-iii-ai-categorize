import { v4 as uuid } from "uuid";
import EventEmitter from "events";
import fs from "fs";
import path from "path";

const JOBS_FILE = path.join(process.cwd(), "jobs.json");

export default class JobList {
    #jobs = new Map();
    #eventEmitter = new EventEmitter();

    constructor() {
        this.loadJobsFromFile();
        this.startCleanupInterval();
    }

    on(event, listener) {
        this.#eventEmitter.on(event, listener);
    }

    getJobs() {
        return this.#jobs;
    }

    getJob(id) {
        return this.#jobs.get(id);
    }

    createJob(data) {
        const id = uuid();
        const created = new Date();
        const job = {
            id,
            created,
            status: "queued",
            data,
        };
        this.#jobs.set(id, job);
        this.saveJobsToFile();
        this.#eventEmitter.emit("job created", { job, jobs: Array.from(this.#jobs.values()) });
        return job;
    }

    updateJobData(id, data) {
        const job = this.#jobs.get(id);
        if (job) {
            job.data = { ...job.data, ...data };
            this.saveJobsToFile();
            this.#eventEmitter.emit("job updated", { job, jobs: Array.from(this.#jobs.values()) });
        }
    }

    setJobInProgress(id) {
        const job = this.#jobs.get(id);
        if (job) {
            job.status = "in_progress";
            this.saveJobsToFile();
            this.#eventEmitter.emit("job updated", { job, jobs: Array.from(this.#jobs.values()) });
        }
    }

    setJobFinished(id) {
        const job = this.#jobs.get(id);
        if (job) {
            job.status = "finished";
            this.saveJobsToFile();
            this.#eventEmitter.emit("job updated", { job, jobs: Array.from(this.#jobs.values()) });
        }
    }

    setJobHumanInput(id) {
        const job = this.#jobs.get(id);
        if (job) {
            job.status = "human_input";
            this.saveJobsToFile();
            this.#eventEmitter.emit("job updated", { job, jobs: Array.from(this.#jobs.values()) });
        }
    }

    setJobFailed(jobId, errorMessage) {
        const job = this.getJob(jobId);
        if (job) {
            job.status = "failed";
            job.errorMessage = errorMessage;
            this.saveJobsToFile();
            this.#eventEmitter.emit("job updated", { job, jobs: Array.from(this.#jobs.values()) });
        }
    }

    startCleanupInterval() {
        setInterval(() => this.cleanupOldJobs(), 60 * 60 * 1000);
    }

    cleanupOldJobs() {
        const now = new Date();
        let jobsDeleted = false;
        for (const [id, job] of this.#jobs.entries()) {
            if ((job.status === "finished" || job.status === "failed") &&
                (now - new Date(job.created) > 24 * 60 * 60 * 1000)) {
                this.#jobs.delete(id);
                jobsDeleted = true;
            }
        }
        if (jobsDeleted) {
            this.saveJobsToFile();
            this.#eventEmitter.emit("jobs cleaned", { jobs: Array.from(this.#jobs.values()) });
        }
    }

    manualCleanup() {
        this.cleanupOldJobs();
    }

    saveJobsToFile() {
        try {
            const jobsArray = Array.from(this.#jobs.values());
            fs.writeFileSync(JOBS_FILE, JSON.stringify(jobsArray, null, 2));
        } catch (err) {
            console.error("Errore nel salvataggio dei lavori:", err);
        }
    }

    loadJobsFromFile() {
        if (fs.existsSync(JOBS_FILE)) {
            try {
                const data = fs.readFileSync(JOBS_FILE, "utf8");
                const jobsArray = JSON.parse(data);
                this.#jobs = new Map(jobsArray.map(job => [job.id, job]));
                console.log(`Caricati ${this.#jobs.size} lavori dal file.`);
            } catch (err) {
                console.error("Errore nel caricamento dei lavori, file corrotto?", err);
            }
        }
    }
}
