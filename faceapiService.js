/**
 * https://www.npmjs.com/package/@vladmandic/face-api
 */

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const faceapi = require('@vladmandic/face-api');
const modelPathRoot = './models';

let optionsSSDMobileNet;

async function image(input) {
  // read input image file and create tensor to be used for processing
  let buffer;
  if (input.startsWith('http:') || input.startsWith('https:')) {
    const res = await fetch(input);
    if (res && res.ok) buffer = await res.buffer();
    // else console.log('Invalid image URL:' + input + res.status, res.statusText, res.headers.get('content-type'));
  } else {
    buffer = fs.readFileSync(input);
  }

  // decode image using tfjs-node so we don't need external depenencies
  // can also be done using canvas.js or some other 3rd party image library
  if (!buffer) return {};
  const tensor = tf.tidy(() => {
    const decode = faceapi.tf.node.decodeImage(buffer, 3);
    let expand;
    if (decode.shape[2] === 4) { // input is in rgba format, need to convert to rgb
      const channels = faceapi.tf.split(decode, 4, 2); // tf.split(tensor, 4, 2); // split rgba to channels
      const rgb = faceapi.tf.stack([channels[0], channels[1], channels[2]], 2); // stack channels back to rgb and ignore alpha
      expand = faceapi.tf.reshape(rgb, [1, decode.shape[0], decode.shape[1], 3]); // move extra dim from the end of tensor and use it as batch number instead
    } else {
      expand = faceapi.tf.expandDims(decode, 0);
    }
    const cast = faceapi.tf.cast(expand, 'float32');
    return cast;
  });
  return tensor;
}

async function detect(tensor) {
  try {
    const detectedFaces = await faceapi.detectAllFaces(tensor, optionsSSDMobileNet);
    return detectedFaces;
  } catch (err) {
    console.log("Error while detecting faces: " + err.message);
    return [];
  }
}

async function main(jobPath) {
  const tensor = await image(jobPath);
  const detectedFaces = await detect(tensor);
  tensor.dispose();

  return detectedFaces;
}

async function loadModel() {
  console.log("FaceAPI single-process test");

  await faceapi.tf.setBackend("tensorflow");
  await faceapi.tf.enableProdMode();
  // await faceapi.tf.ENV.setBackend("DEBUG", false);
  await faceapi.tf.ready();

  console.log(
    `Version: TensorFlow/JS ${faceapi.tf?.version_core} FaceAPI ${faceapi.version.faceapi
    } Backend: ${faceapi.tf?.getBackend()}`
  );

  console.log("Loading FaceAPI model");
  const modelPath = path.join(__dirname, modelPathRoot);
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
  optionsSSDMobileNet = new faceapi.SsdMobilenetv1Options({
    minConfidence: 0.5,
  });
  console.log("FaceAPI model loaded");
}

module.exports = {
  load: loadModel,
  detect: main,
};