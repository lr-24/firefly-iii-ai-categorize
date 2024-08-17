import { v4 as uuid } from "uuid";
import EventEmitter from "events";

export default class JobList {
    #jobs = new Map();
    #eventEmitter = new EventEmitter();

    constructor() {
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
            job.errorMessage = errorMessage;
            this.#eventEmitter.emit('job updated', {job, jobs: Array.from(this.#jobs.values())});
        }
    }

    startCleanupInterval() {
        setInterval(() => this.cleanupOldJobs(), 60 * 60 * 1000);
    }

    cleanupOldJobs() {
        const now = new Date();
        for (const [id, job] of this.#jobs.entries()) {
            if ((job.status === 'finished' || job.status === 'failed') && 
                //(now - job.created > 24 * 60 * 60 * 1000)) {
                (now - job.created > 24)) {
                this.#jobs.delete(id);
                this.#eventEmitter.emit('job deleted', {id, jobs: Array.from(this.#jobs.values())});
            }
        }
    }

    manualCleanup() {
        this.cleanupOldJobs();
    }
}
