const fs = require('fs');
const path = require('path');

class StatLogger {
  static JOB_ID = "jobId";
  static STEAL_REQUEST_TIME = "stealRequestTime";
  static JOB_RECEIVED_START_TIME = "jobReceivedStartTime";
  static JOB_RECEIVED_END_TIME = "jobReceivedEndTime";
  static JOB_WAIT_TIME = "jobWaitTime(avg)";
  static JOB_TRANSMISSION_TIME = "jobTransmissionTime(avg)";
  static UNZIP_START_TIME = "unzipStartTime";
  static UNZIP_END_TIME = "unzipEndTime";
  static JOB_START_TIME = "jobStartTime";
  static JOB_END_TIME = "jobEndTime";
  static COMPUTATION_TIME = "computationTime";
  static RESULT_SENT_TIME = "resultSentTime";

  jobLogs = [];
  jobReceivedStartTime = [];

  static logHeader() {
    return `${this.JOB_ID},${this.STEAL_REQUEST_TIME},${this.JOB_RECEIVED_START_TIME},${this.JOB_RECEIVED_END_TIME},${this.JOB_WAIT_TIME},${this.JOB_TRANSMISSION_TIME},${this.UNZIP_START_TIME},${this.UNZIP_END_TIME},${this.JOB_START_TIME},${this.JOB_END_TIME},${this.COMPUTATION_TIME},${this.RESULT_SENT_TIME}`;
  }

  saveLogToFile() {
    var log = StatLogger.logHeader();
    for (var key in this.jobLogs) {
      log += `\n${key},${this.jobLogs[key][StatLogger.STEAL_REQUEST_TIME]},${this.jobLogs[key][StatLogger.JOB_RECEIVED_START_TIME]},${this.jobLogs[key][StatLogger.JOB_RECEIVED_END_TIME]},${this.jobLogs[key][StatLogger.JOB_WAIT_TIME]},${this.jobLogs[key][StatLogger.JOB_TRANSMISSION_TIME]},${this.jobLogs[key][StatLogger.UNZIP_START_TIME]},${this.jobLogs[key][StatLogger.UNZIP_END_TIME]},${this.jobLogs[key][StatLogger.JOB_START_TIME]},${this.jobLogs[key][StatLogger.JOB_END_TIME]},${this.jobLogs[key][StatLogger.COMPUTATION_TIME]},${this.jobLogs[key][StatLogger.RESULT_SENT_TIME]}`;
    }
    fs.writeFile(path.join(__dirname, 'runStat.csv'), log, (err) => {
      if (err) {
        console.log("Could not write log to file");
      }
    });
  }
}

module.exports = StatLogger;