/**
 * @desc Success response wrapper
 * 
 * @param {object | array} data 
 * @param {string} message 
 * @returns 
 */
exports.responseSuccess = (data, message) => {
    return {
        status: 'success',
        data,
        message
    };
};

/**
 * @desc Error response wrapper
 * 
 * @param {object | array} data 
 * @param {string} message 
 * @returns 
 */
exports.responseError = (data, message) => {
    return {
        status: 'error',
        data,
        message
    };
};