// Setup basic express server
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
	pingTimeout: 600000,
	pingInterval: 2500
});
const formidable = require('formidable');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const faceApiService = require('./faceapiService');
const { responseSuccess, responseError } = require('./responseApi');
const StatLogger = require("./StatLogger");

const port = process.env.PORT || 3000;

const WORKER_HEARTBEAT_INTERVAL = 2500;

const COMPLETED_JOBS_BUFFER = 10;
const RESULT_SYMBOL = 'RESULT'
const FACE_RESULT_BREAKER = '!';
const FACE_VALUE_SEPARATOR = ':';
const COMPUTATION_TIME_SEPARATOR = ',';
const MESSAGE_BREAK = '#';
const JOB_DIR = path.join(__dirname, '/upload/job');

const STEAL_LIMIT = 5;
const PARAM_SYMBOL = 'PARAM';
const PARTITION_BREAK = 'PARTITION';

const statLogger = new StatLogger();
// const timeLogger = new TimeLogger(getCurrentTimeInMillis());
const jobPool = {
	isDelegatorDoneWithJobs: false,
	isAddingNewJobs: false,
	isWorking: false,
	allInitJobsReceived: false,
	workType: "",
	jobQueue: [],
	doneJobs: []
};
var stealRequestTime;
var writeResultCount = 0;

faceApiService.load();

function getCurrentTimeInMillis() {
	return Date.now();
}

server.listen(port, () => {
	console.log('Server listening at port %d', port);
});

// Establish socket connection
io.on('connection', (socket) => {
	console.log("Connected");

	setInterval(() => {
		if (!jobPool.isDelegatorDoneWithJobs) {
			console.log("sending heartbeat");
			socket.volatile.emit('ping');
		}
	}, WORKER_HEARTBEAT_INTERVAL);

	// WORKER COMMUNICATION THREAD PART START
	// init signal received from delegator
	socket.on('initSignal', (data) => {
		jobPool.isDelegatorDoneWithJobs = false;
		console.log("Start stealing...");
		stealRequestTime = getCurrentTimeInMillis();
		stealFromDelegator();
	});

	// stolen jobs received from delegator
	socket.on('stolenJobs', async (data) => {
		const jobStealRequestTime = stealRequestTime;
		const jobReceivedEndTime = getCurrentTimeInMillis();

		// resetting allInitJobsReceived flag to be false;
		// we will receive the related message from the server to set that flag
		jobPool.allInitJobsReceived = false;

		console.log("Received stolen jobs");

		// add stolen jobs to the pool;
		await addStolenJobsToPool(data, jobStealRequestTime, jobReceivedEndTime);

		// optional delaying of worker to mimic slow worker
		await delayWorker(false);

		// start worker’s consumer thread;
		startConsumerThread();
		// send file received message to delegator so that 
		// delegator can continue sending remaining files if any
		socket.emit('FileReceivedByWorker');
		stealRequestTime = getCurrentTimeInMillis();
	});

	// Received all the jobs in current batch
	socket.on('allInitJobsSent', (data) => {
		jobPool.allInitJobsReceived = true;

		if (!jobPool.isAddingNewJobs && jobPool.jobQueue.length == 0 && jobPool.doneJobs.length > 0) {
			sendResultToDelegator();
		}
	});

	socket.on("resultsReceived", (data) => {
		writeResultCount -= 1;
		if (!jobPool.isAddingNewJobs && jobPool.jobQueue.length == 0 && jobPool.allInitJobsReceived && jobPool.doneJobs.length == 0 && writeResultCount == 0) {
			stealFromDelegator();
		}
	});

	// steal request received from delegator
	socket.on('stealRequest', (data) => {
		console.log('Received steal request from delegator');
		var stolenJobs = [];
		if (jobPool.jobQueue.length >= STEAL_LIMIT) {
			while (stolenJobs.length < STEAL_LIMIT) {
				const job = jobPool.jobQueue.shift();
				stolenJobs.push(job);
				deleteJobFromJobDirectory(job);
			}
		}

		if (stolenJobs.length > 0) {
			sendStolenJobsToDelegator(stolenJobs);
		} else {
			sendNoJobsToSteal();
		}
	});

	// no jobs received from delegator
	socket.on('noJobsToSteal', (data) => {
		stealFromDelegator();
	});

	// termination signal received from delegator
	socket.on('terminationSignal', (data) => {
		console.log("All jobs completed at delegator side and result has been presented");
		jobPool.isDelegatorDoneWithJobs = true;

		// write log to file
		statLogger.saveLogToFile();
		// terminate;
	});
	// WORKER COMMUNICATION THREAD PART END

	async function addStolenJobsToPool(data, stealRequestTime, jobReceivedEndTime) {
		jobPool.isAddingNewJobs = true;
		var work = JSON.parse(data);
		var filePath = work.filePath;

		// load the job received start time from logger
		const jobReceivedStartTime = statLogger.jobReceivedStartTime[path.basename(filePath)];
		delete(statLogger.jobReceivedStartTime[path.basename(filePath)]);

		// add work method to jobpool
		jobPool.workType = work.method;

		// extract files in zip to job directory and add to job queue
		console.log("Extracting file : " + filePath);
		const zip = new AdmZip(filePath);
		zip.getEntries().forEach((zipEntry) => {
			const unzipStartTime = getCurrentTimeInMillis();
			if (zip.extractEntryTo(zipEntry, JOB_DIR, true, true)) {
				const unzipEndTime = getCurrentTimeInMillis();
				jobPool.jobQueue.push(path.join(JOB_DIR, zipEntry.entryName));

				// Start logging timings for the job
				statLogger.jobLogs[zipEntry.entryName] = {};
				statLogger.jobLogs[zipEntry.entryName][StatLogger.STEAL_REQUEST_TIME] = stealRequestTime;
				statLogger.jobLogs[zipEntry.entryName][StatLogger.JOB_RECEIVED_START_TIME] = jobReceivedStartTime;
				statLogger.jobLogs[zipEntry.entryName][StatLogger.JOB_RECEIVED_END_TIME] = jobReceivedEndTime;
				statLogger.jobLogs[zipEntry.entryName][StatLogger.JOB_WAIT_TIME] = (jobReceivedStartTime - stealRequestTime) / zip.getEntries().length;
				statLogger.jobLogs[zipEntry.entryName][StatLogger.JOB_TRANSMISSION_TIME] = (jobReceivedEndTime - stealRequestTime) / zip.getEntries().length;
				statLogger.jobLogs[zipEntry.entryName][StatLogger.UNZIP_START_TIME] = unzipStartTime;
				statLogger.jobLogs[zipEntry.entryName][StatLogger.UNZIP_END_TIME] = unzipEndTime;
			}
		});

		console.log("Jobs added to job pool");
		fs.unlink(filePath, (err) => {
			if (err) {
				console.log("Could not delete file");
			}
		});

		jobPool.isAddingNewJobs = false;
	}

	/**
	 * Mimics slow worker. If enabled the worker will wait for the provided amount of time before starting the obtained work
	 * @param {Boolean} delayWorker True if the worker is to be delayed, false otherwise
	 */
	async function delayWorker(delayWorker) {
		const delayingThresholdJobCount = 150;
		const delayTimeForWorkerInMillis = 20000;
		if (delayWorker) {
			if (statLogger.getCompletedJobsCount() > delayingThresholdJobCount) {
				await new Promise(r => setTimeout(r, delayTimeForWorkerInMillis));
			}
		}
	}

	async function startConsumerThread() {
		if (!jobPool.isWorking) {
			jobPool.isWorking = true;
			while (jobPool.jobQueue.length > 0) {
				const jobStartTime = getCurrentTimeInMillis();
				console.log("Found new job, will start working on it...");
				var jobPath = jobPool.jobQueue.shift();
				const detectedFaces = await faceApiService.detect(jobPath);
				const jobEndTime = getCurrentTimeInMillis();
				const computationTime = jobEndTime - jobStartTime;
				const fileName = path.basename(jobPath)
				jobPool.doneJobs.push({
					name: fileName,
					faceCount: detectedFaces.length,
					computationTime: computationTime
				});
				statLogger.jobLogs[fileName][StatLogger.JOB_START_TIME] = jobStartTime;
				statLogger.jobLogs[fileName][StatLogger.JOB_END_TIME] = jobEndTime;
				statLogger.jobLogs[fileName][StatLogger.COMPUTATION_TIME] = computationTime;

				deleteJobFromJobDirectory(jobPath);

				if (jobPool.doneJobs.length >= COMPLETED_JOBS_BUFFER) {
					sendResultToDelegator();
					if (jobPool.jobQueue.length == 0) {
						jobPool.isWorking = false;
						return;
					}
				}
			}
			jobPool.isWorking = false;
			if (!jobPool.isAddingNewJobs && jobPool.jobQueue.length == 0 && jobPool.allInitJobsReceived) {
				sendResultToDelegator();
			}

		} else {
			console.log("Already working ...");
		}
	}

	function stealFromDelegator() {
		if (!jobPool.isDelegatorDoneWithJobs) {
			stealRequestTime = getCurrentTimeInMillis();
			socket.emit('StealRequest');
		}
	}

	function sendResultToDelegator() {
		console.log("Done with the jobs in jobpool, now sending result...");
		const completedJobs = []
		var resultToSend = RESULT_SYMBOL;
		while (jobPool.doneJobs.length) {
			const doneJob = jobPool.doneJobs.shift();
			resultToSend += FACE_RESULT_BREAKER + doneJob.name + FACE_VALUE_SEPARATOR + doneJob.faceCount + COMPUTATION_TIME_SEPARATOR + doneJob.computationTime;

			completedJobs.push(doneJob.name);
		}
		resultToSend += MESSAGE_BREAK;

		const resultSentTime = getCurrentTimeInMillis();
		socket.emit('Results', {
			result: resultToSend
		});
		writeResultCount += 1;
		console.log("Result sent");
		completedJobs.forEach(jobFileName => {
			statLogger.jobLogs[jobFileName][StatLogger.RESULT_SENT_TIME] = resultSentTime;
		});
	}

	function deleteJobFromJobDirectory(jobPath) {
		fs.unlink(jobPath, err => {
			if (err) throw err;
		});
	}

	function sendNoJobsToSteal() {
		socket.emit('NoJobsToSteal');
		console.log("Sorry, but I do not have any jobs at the moment");
	}

	function sendStolenJobsToDelegator(stolenJobs) {
		console.log("Sending stolen jobs (from here) to Delegator ...");

		var jobsToSend = PARAM_SYMBOL;
		while (stolenJobs.length) {
			const job = stolenJobs.shift();
			jobsToSend += path.basename(job) + PARTITION_BREAK;
		}
		jobsToSend += MESSAGE_BREAK;

		socket.emit('StolenJobs', {
			stolenJobs: jobsToSend
		});
		console.log("Stolen jobs sent");
	}
});

// Receive file upload request
app.post('/api/upload', (req, res) => {
	const jobReceivedStartTime = getCurrentTimeInMillis();
	console.log("Receiving file...");
	const form = formidable();
	const uploadDir = __dirname + "/upload";
	fs.mkdir(uploadDir, (error) => {
		if (!error || error.code == 'EEXIST') {
			form.uploadDir = uploadDir;

			form.parse(req, (err, fields, files) => {
				if (err) {
					res.json(responseError({ data: "" }, "There was some error during the file upload"));
				}

				// save the time we started receiving the (zip file) job
				statLogger.jobReceivedStartTime[files.file.name] = jobReceivedStartTime;

				const oldPath = files.file.path;
				const newPath = path.join(form.uploadDir, files.file.name);

				// renaming file to match the uploaded filename
				fs.rename(oldPath, newPath, (err) => {
					if (err) {
						res.json(responseError({ data: "" }, "There was some error during the renaming of uploaded file"));
					}
					// file renamed successfully
				});
				res.json(responseSuccess({ file_path: newPath }, "File has been uploaded to the provided path"));
			});
		}
	});
});