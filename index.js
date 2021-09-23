// Setup basic express server
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const formidable = require('formidable');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const faceApiService = require('./faceapiService');
const { success, error } = require('./responseApi');
const faceapiService = require('./faceapiService');

const port = process.env.PORT || 3000;

const completedJobsbuffer = 10;
const resultSymbol = 'RESULT'
const faceResultBreaker = '!';
const faceValueSeparator = ':';
const messageBreak = '#';
const jobDir = path.join(__dirname, "/upload/job");

var jobPool = {
	isAddingNewJobs: false,
	isWorking: false,
	allInitJobsReceived: false,
	workType: "",
	jobQueue: [],
	doneJobs: []
};

faceApiService.load();

server.listen(port, () => {
	console.log('Server listening at port %d', port);
});

// Establish socket connection
io.on('connection', (socket) => {
	console.log("Connected");

	// WORKER COMMUNICATION THREAD PART START
	// init signal received from delegator
	socket.on('initSignal', (data) => {
		console.log("Start stealing...");
		stealFromDelegator();
	});

	// stolen jobs received from delegator
	socket.on('stolenJobs', (data) => {
		// resetting allInitJobsReceived flag to be false;
		// we will receive the related message from the server to set that flag
		jobPool.allInitJobsReceived = false;

		console.log("Received stolen jobs");
		// send file received message to delegator so that 
		// delegator can continue sending remaining files if any
		socket.emit('FileReceivedByWorker');

		// add stolen jobs to the pool;
		addStolenJobsToPool(data);

		// start worker’s consumer thread;
		startConsumerThread();
	});

	// Received all the jobs in current batch
	socket.on('allInitJobsSent', (data) => {
		jobPool.allInitJobsReceived = true;

		if (!jobPool.isAddingNewJobs && jobPool.jobQueue.length == 0 && jobPool.doneJobs.length > 0) {
			sendResultToDelegator();
		}
	});

	socket.on("resultsReceived", (data) => {
		if (!jobPool.isAddingNewJobs && jobPool.jobQueue.length == 0 && jobPool.allInitJobsReceived && jobPool.doneJobs.length == 0) {
			stealFromDelegator();
		}
	});

	// steal request received from delegator
	socket.on('stealRequest', (data) => {
		// if job pool = empty then
		// 	send no jobs left signal to the delegator;
		// 	end
		// else
		// 	start victim thread;
		// 	end
	});

	// no jobs received from delegator
	socket.on('noJobsToSteal', (data) => {
		stealFromDelegator();
	});

	// termination signal received from delegator
	socket.on('terminationSignal', (data) => {
		console.log("All jobs completed at delegator side and result has been presented");
		// terminate;
	});
	// WORKER COMMUNICATION THREAD PART END

	function addStolenJobsToPool(data) {
		jobPool.isAddingNewJobs = true;
		var work = JSON.parse(data);
		var filePath = work.filePath;

		// add work method to jobpool
		jobPool.workType = work.method;

		// extract files in zip to job directory and add to job queue
		const zip = new AdmZip(filePath);
		zip.getEntries().forEach((zipEntry) => {
			if (zip.extractEntryTo(zipEntry, jobDir, true, true)) {
				jobPool.jobQueue.push(path.join(jobDir, zipEntry.entryName));
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

	async function startConsumerThread() {
		if (!jobPool.isWorking) {
			jobPool.isWorking = true;
			while (jobPool.jobQueue.length > 0) {
				console.log("Found new job, will start working on it...");
				var jobPath = jobPool.jobQueue.shift();
				const detectedFaces = await faceapiService.detect(jobPath);
				jobPool.doneJobs.push({
					name: path.basename(jobPath),
					faceCount: detectedFaces.length
				});

				deleteJobFromJobDirectory(jobPath);

				if (jobPool.doneJobs.length >= completedJobsbuffer) {
					sendResultToDelegator();
					jobPool.isWorking = false;
					return;
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
		socket.emit('StealRequest');
	}

	function sendResultToDelegator() {
		console.log("Done with the jobs in jobpool, now sending result...");

		var resultToSend = resultSymbol;
		while (jobPool.doneJobs.length) {
			const doneJob = jobPool.doneJobs.shift();
			resultToSend += faceResultBreaker + doneJob.name + faceValueSeparator + doneJob.faceCount;
		}
		resultToSend += messageBreak;

		socket.emit('Results', {
			result: resultToSend
		});
		console.log("Result sent");
		// reset the result after sending it to the delegator
	}

	function deleteJobFromJobDirectory(jobPath) {
		fs.unlink(jobPath, err => {
			if (err) throw err;
		});
	}

	function sendNoJobsToSteal() {

	}

	function sendStolenJobsToDelegator() {

	}
});

// Receive file upload request
app.post('/api/upload', (req, res) => {
	console.log("Receiving file...");
	const form = formidable();
	const uploadDir = __dirname + "/upload";
	fs.mkdir(uploadDir, (error) => {
		if (!error || error.code == 'EEXIST'){
			form.uploadDir = uploadDir;
		
			form.parse(req, (err, fields, files) => {
				if (err) {
					res.json(error({ data: "" }, "There was some error during the file upload"));
				}
		
				const oldPath = files.file.path;
				const newPath = path.join(form.uploadDir, files.file.name);
		
				// renaming file to match the uploaded filename
				fs.rename(oldPath, newPath, (err) => {
					if (err) {
						res.json(error({ data: "" }, "There was some error during the renaming of uploaded file"));
					}
					// file renamed successfully
				});
				res.json(success({ file_path: newPath }, "File has been uploaded to the provided path"));
			});
		}
	});
});