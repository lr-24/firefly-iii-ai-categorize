import {v4 as uuid} from "uuid";
import EventEmitter from "events";

export default class JobList {
    #jobs = new Map();
    #eventEmitter = new EventEmitter();

    constructor() {}

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
        const id = uuid()
        const created = new Date();
        const job = {
            id,
            created,
            status: "queued",
            data,
        }
        this.#jobs.set(id, job);
        this.#eventEmitter.emit('job created', {job, jobs: Array.from(this.#jobs.values())})
        return job;
    }

    updateJobData(id, data) {
        const job = this.#jobs.get(id);
        if (job) {
            job.data = { ...job.data, ...data };
            this.#eventEmitter.emit('job updated', {job, jobs: Array.from(this.#jobs.values())});
        }
    }

    setJobInProgress(id) {
        const job = this.#jobs.get(id);
        if (job) {
            job.status = "in_progress";
            this.#eventEmitter.emit('job updated', {job, jobs: Array.from(this.#jobs.values())});
        }
    }

    setJobFinished(id) {
        const job = this.#jobs.get(id);
        if (job) {
            job.status = "finished";
            this.#eventEmitter.emit('job updated', {job, jobs: Array.from(this.#jobs.values())});
        }
    }

    setJobHumanInput(id) {
        const job = this.#jobs.get(id);
        if (job) {
            job.status = "human_input";
            this.#eventEmitter.emit('job updated', {job, jobs: Array.from(this.#jobs.values())});
        }
    }

    setJobFailed(jobId, errorMessage) {
    const job = this.getJob(jobId);
    if (job) {
        job.status = 'failed';
        job.errorMessage = errorMessage; // Store error message for diagnostics
    }
}
}



