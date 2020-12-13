const PNG_HEADER = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** @type {File} */
var PNG_FILE;

async function imageChanged() {
    resetAll();
    PNG_FILE = document.getElementById('fileupload').files[0];
    
    let fileHeader = await readFileBytes(PNG_FILE, 0, 8);
    for (let i=0; i<PNG_HEADER.length; i++) {
        if (PNG_HEADER[i] != fileHeader[i]) {
            imageNotPNG();
            return;
        }
    }

    // The file matches the PNG header.
    console.log('Is a PNG!');

    // Test: Save the PNG back to disk.
    let stream = streamSaver.createWriteStream('image.png', {size: PNG_FILE.size});
    new Response(PNG_FILE).body.pipeTo(stream);
}

function imageNotPNG() {
    alert('This file is not a PNG!')
}

function resetAll() {

}

/**
 * Convert chunk header bytes into a string
 * @param {Uint8Array} bytes
 * @returns {String}
 */
function stringFromChunkHeader(bytes) {
    headerString = "";
    for (let i=0; i<bytes.length; i++) {
        headerString += String.fromCharCode(bytes[i]);
    }
    return headerString;
}

/**
 * Convert a chunk header string into bytes
 * @param {String} headerString
 * @returns {Uint8Array}
 */
function chunkHeaderFromString(headerString) {
    let bytes = new Uint8Array(headerString.length);
    for (let i=0; i<headerString.length; i++) {
        bytes[i] = headerString.charCodeAt(i);
    }
    return bytes;
}

/**
 * Read a range of bytes from a File.
 * @param {File} file
 * @param {Number} start
 * @param {Number} end
 * @returns {Uint8Array}
 */
async function readFileBytes(file, start, end) {
    let buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
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