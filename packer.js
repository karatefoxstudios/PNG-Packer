const PNG_HEADER = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** @type {File} */
var PNG_FILE;

function imageChanged() {
    resetAll();
    PNG_FILE = document.getElementById('fileupload').files[0];
}

function resetAll() {

}

function imageNotPNG() {
    console.log('Not a PNG!')
}

/**
 * Convert an array of bytes to an integer
 * @param {Uint8Array} bytes
 * @returns {Number}
 */
function intFromBytes(bytes) {
    bytes = bytes.reverse();
    total = 0;
    for (let i=0; i<bytes.length; i++) {
        total += bytes[i] << (i*8);
    }
    return total;
}

/**
 * Convert an integer to an array of bytes
 * @param {Number} integer
 * @param {Number} count 
 * @returns {Uint8Array} 
 */
function bytesFromInt(integer, count) {
    let bytes = new Uint8Array(count);
    for (let i=0; i<count; i++) {
        bytes[i] = (integer >>> (i*8)) & 0xFF;
    }
    return bytes.reverse();
}