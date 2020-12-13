const PNG_HEADER = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** @type {File} */
var PNG_FILE;
/** @type {Array} */
var CHUNKS = [];
/** @type {Array} */
var FILES;

async function imageChanged() {
    resetAll();
    PNG_FILE = document.getElementById('imageupload').files[0];
    
    let fileHeader = await readFileBytes(PNG_FILE, 0, 8);
    for (let i=0; i<PNG_HEADER.length; i++) {
        if (PNG_HEADER[i] != fileHeader[i]) {
            imageNotPNG();
            return;
        }
    }

    // The file matches the PNG header.
    await locateChunks();

    console.log(CHUNKS)

    /*
    // Test: Save the PNG back to disk.
    let stream = streamSaver.createWriteStream('image.png', {size: PNG_FILE.size});
    new Response(PNG_FILE).body.pipeTo(stream);
    */
}

async function locateChunks() {
    let filesize = PNG_FILE.size;
    let index = PNG_HEADER.length; // Skip over the PNG header
    while (index != filesize) {
        // Read the chunk length
        let lengthBytes = await readFileBytes(PNG_FILE, index, index+4);
        let length = intFromBytes(lengthBytes);
        index += 4;
        // Read the chunk header
        let headerBytes = await readFileBytes(PNG_FILE, index, index+4);
        let header = stringFromChunkHeader(headerBytes);
        //console.log(header);
        index += 4;
        // Mark the chunk data indices
        let dataStart = index;
        index += length;
        let dataEnd = index;
        // Read the chunk checksum
        let checksumBytes = await readFileBytes(PNG_FILE, index, index+4);
        let checksum = intFromBytes(checksumBytes);
        index += 4;

        CHUNKS.push({
            header: header,
            length: length,
            dataStart: dataStart,
            dataEnd: dataEnd,
            checksum: checksum
        });
    }
}

function imageNotPNG() {
    alert('This file is not a PNG!')
}

function resetAll() {
    PNG_FILE = undefined;
    CHUNKS = [];
}

async function filesChanged() {
    FILES = document.getElementById('filesupload').files;
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
    let buffer = await file.slice(start, end).arrayBuffer();
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