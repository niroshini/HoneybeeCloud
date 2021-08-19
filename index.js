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
const {success, error} = require('./responseApi');

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log('Server listening at port %d', port);
});

// Establish socket connection
io.on('connection', (socket) => {
	
	console.log("Connected");
	
	// when delegator sends connection request
	socket.on('work to do', (data) => {
		console.log("Work received");
		// send delegator the result of work
		console.log(data);
		var work = JSON.parse(data);
		var method = work.method;
		var filePath = work.filePath;

		const zip = new AdmZip(filePath);
		const jobDir = path.join(__dirname, "/upload/job")
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
	});
	
});

// Receive file upload request
app.post('/api/upload', (req, res) => {
	console.log("Receiving file...");
	const form = formidable();
	form.uploadDir = __dirname + "/upload";

	form.parse(req, (err, fields, files) => {
		if (err) {
			res.json(error({data: ""}, "There was some error during the file upload"));
		}
		console.log("file uploaded at : " + files.file.path);

		const oldPath = files.file.path;
		const newPath = path.join(form.uploadDir, files.file.name);

		console.log('renaming file to match the uploaded filename');
		fs.rename(oldPath, newPath, (err) => {
			if (err) {
				res.json(error({data: ""}, "There was some error during the renaming of uploaded file"));
			}
			console.log('file renamed successfully');
		});
		res.json(success({file_path: newPath}, "File has been uploaded to the provided path"));
	});
});