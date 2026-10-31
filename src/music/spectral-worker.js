import {parentPort,workerData} from 'node:worker_threads';
import {describeSpectrum} from './spectral.js';
parentPort.postMessage(describeSpectrum(workerData.frames,workerData.energy));
