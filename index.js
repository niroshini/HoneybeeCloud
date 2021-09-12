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
const LQueue = require('linked-queue');

const port = process.env.PORT || 3000;
const resultSymbol = 'RESULT'
const faceResultBreaker = '!';
const faceValueSeparator = ':';
const messageBreak = '#';
const jobDir = path.join(__dirname, "/upload/job");

var jobPool = {
	allInitJobsSent: false,
	workType: "",
	jobQueue: new LQueue(),
	result: ""
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
		stealFromDelegator();
	});

	// stolen jobs received from delegator
	socket.on('stolenJobs', (data) => {
		console.log(data);
		// send file received message to delegator so that 
		// delegator can continue sending remaining files
		socket.emit('FileReceivedByWorker');

		// add stolen jobs to the pool;
		addStolenJobsToPool(data);

		// start worker’s consumer thread;
		// if (jobPool.allInitJobsSent) {
		// 	startConsumerThread();
		// }
	});

	socket.on("resultsReceived", (data) => {
		stealFromDelegator();
	});

	// Received all the jobs in current batch
	socket.on('allInitJobsSent', (data) => {
		jobPool.allInitJobsSent = true;
		startConsumerThread();
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
		// TODO: currently only extracting to the job folder, need to add those extracted images to job pool list
		var work = JSON.parse(data);
		var filePath = work.filePath;

		// add work method to jobpool
		jobPool.workType = work.method;

		const zip = new AdmZip(filePath);
		zip.extractAllTo(jobDir, true);
		console.log("File content extracted");
		fs.unlink(filePath, (err) => {
			if (err) {
				console.log("Could not delete file");
			}
			console.log("File deleted after extracting");
		});
	}

	function startConsumerThread() {
		// TODO: currently directly reading from the job folder instead of job list array
		var resultToSend = resultSymbol;
		if (jobPool.workType === "faceDetect") {
			console.log("Start detecting face");
			faceApiService.detect(jobDir)
				.then((results) => {
					results.forEach(imageResult => {
						resultToSend += faceResultBreaker + imageResult.image_name + faceValueSeparator + imageResult.face_detected;
					});
					resultToSend += messageBreak;
					deleteJobFromPool();
					sendResultToDelegator(resultToSend);
				})
				.catch((error) => {
					socket.emit('results', {
						result: resultToSend
					});
					console.log("Error result sent" + error);
				});
		}

		// job <- get first job in pool;
		// while job 6= null do
		// 	execute job and add result to list;
		// 	if list:size >= buffer then
		// 		send results to delegator ;
		// sendResultToDelegator();
		// 	end
		// 	job <- get first job in pool
		// end
		// steal from delegator;
	}

	function stealFromDelegator() {
		socket.emit('StealRequest');
	}

	function sendResultToDelegator(resultToSend) {
		console.log("Sending result");

		socket.emit('Results', {
			result: resultToSend
		});
		console.log("Result sent");
	}

	function deleteJobFromPool() {
		fs.rmdirSync(jobDir, { recursive: true }, err => { });
	}

	function sendNoJobsToSteal() {

	}

	function sendStolenJobsToDelegator() {

	}

	// when delegator sends connection request
	/* socket.on('work to do', (data) => {
		console.log("Work received");
		// send delegator the result of work
		console.log(data);
		var work = JSON.parse(data);
		var method = work.method;
		var filePath = work.filePath;

		const zip = new AdmZip(filePath);
		const jobDir = path.join(__dirname, "/upload/job");
		zip.extractAllTo(jobDir, true);
		console.log("File content extracted");

		fs.unlink(filePath, (err) => {
			if (err) {
				console.log("Could not delete file");
			}
			console.log("File deleted after extracting");
		});

		var resultToSend = Array();
		if (method === "faceDetect") {
			console.log("Start detecting face");
			faceApiService.detect(jobDir)
				.then((results) => {
					console.log(results);
					resultToSend = results

					console.log("Sending result: " + resultToSend);

					socket.emit('results', {
						result: resultToSend
					});
					console.log("Result sent");
				})
				.catch((error) => {
					socket.emit('results', {
						result: resultToSend
					});
					console.log("Error result sent");
				});
		}
	}); */
});

// Receive file upload request
app.post('/api/upload', (req, res) => {
	console.log("Receiving file...");
	const form = formidable();
	form.uploadDir = __dirname + "/upload";

	form.parse(req, (err, fields, files) => {
		if (err) {
			res.json(error({ data: "" }, "There was some error during the file upload"));
		}
		console.log("file uploaded at : " + files.file.path);

		const oldPath = files.file.path;
		const newPath = path.join(form.uploadDir, files.file.name);

		console.log('renaming file to match the uploaded filename');
		fs.rename(oldPath, newPath, (err) => {
			if (err) {
				res.json(error({ data: "" }, "There was some error during the renaming of uploaded file"));
			}
			console.log('file renamed successfully');
		});
		res.json(success({ file_path: newPath }, "File has been uploaded to the provided path"));
	});
});