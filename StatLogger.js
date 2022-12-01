const fs = require('fs');
const path = require('path');

/**
 * Helper class to log job timings
 */
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

  /**
   * 
   * @returns Generate and return header for the log
   */
  static logHeader() {
    return `${this.JOB_ID},${this.STEAL_REQUEST_TIME},${this.JOB_RECEIVED_START_TIME},${this.JOB_RECEIVED_END_TIME},${this.JOB_WAIT_TIME},${this.JOB_TRANSMISSION_TIME},${this.UNZIP_START_TIME},${this.UNZIP_END_TIME},${this.JOB_START_TIME},${this.JOB_END_TIME},${this.COMPUTATION_TIME},${this.RESULT_SENT_TIME}`;
  }

  /**
   * 
   * @returns The total number of jobs completed
   */
  getCompletedJobsCount() {
    return Object.keys(this.jobLogs).length;
  }

  /**
   * Saves (and prints) log to a file
   */
  saveLogToFile() {
    var totalJobWaitTime = 0;
    var totalJobTransmissionTime = 0;
    var totalComputationTime = 0;
    var totalJobs = 0;
    var log = StatLogger.logHeader();
    for (var key in this.jobLogs) {
      totalJobs++;
      totalJobWaitTime += parseInt(this.jobLogs[key][StatLogger.JOB_WAIT_TIME]);
      totalJobTransmissionTime += parseInt(this.jobLogs[key][StatLogger.JOB_TRANSMISSION_TIME]);
      totalComputationTime += parseInt(this.jobLogs[key][StatLogger.COMPUTATION_TIME]);
      log += `\n${key},${this.jobLogs[key][StatLogger.STEAL_REQUEST_TIME]},${this.jobLogs[key][StatLogger.JOB_RECEIVED_START_TIME]},${this.jobLogs[key][StatLogger.JOB_RECEIVED_END_TIME]},${this.jobLogs[key][StatLogger.JOB_WAIT_TIME]},${this.jobLogs[key][StatLogger.JOB_TRANSMISSION_TIME]},${this.jobLogs[key][StatLogger.UNZIP_START_TIME]},${this.jobLogs[key][StatLogger.UNZIP_END_TIME]},${this.jobLogs[key][StatLogger.JOB_START_TIME]},${this.jobLogs[key][StatLogger.JOB_END_TIME]},${this.jobLogs[key][StatLogger.COMPUTATION_TIME]},${this.jobLogs[key][StatLogger.RESULT_SENT_TIME]}`;
    }
    fs.writeFile(path.join(__dirname, 'runStat.csv'), log, (err) => {
      if (err) {
        console.log("Could not write log to file");
      }
    });

    const summary = `Execution Summary: Total jobs completed=${totalJobs}, Avg job wait time=${totalJobWaitTime/totalJobs}, Avg job transmission time=${totalJobTransmissionTime/totalJobs}, Avg computation time=${totalComputationTime/totalJobs}`;
    fs.writeFile(path.join(__dirname, 'runLog.txt'), summary, (err) => {
      if (err) {
        console.log("Could not write log to file");
      }
    });

    console.log(summary)
  }
}

module.exports = StatLogger;