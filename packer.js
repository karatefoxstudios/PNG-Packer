const PNG_HEADER = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PACKED_HEADER = 'paCk';
const PREVIEW_LIMIT = 35840000;

/** @type {File} */
var PNG_FILE;
/** @type {Array} */
var CHUNKS = [];
/** @type {Array} */
var FILES = [];

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

    document.querySelector('.pack-button button').removeAttribute('disabled', ''); // Enable pack button

    // If PNG is under the preview limit, display it
    if (PNG_FILE.size < PREVIEW_LIMIT) {
        let reader = new FileReader();
        reader.onload = (event) => {
            let image = document.querySelector('.image-preview img');
            image.setAttribute('src', event.target.result);
        };
        reader.readAsDataURL(PNG_FILE);
    }

    /*
    // Test: Save the PNG back to disk.
    let stream = streamSaver.createWriteStream('image.png', {size: PNG_FILE.size});
    new Response(PNG_FILE).body.pipeTo(stream);
    */
}

async function packFiles() {
    let stream = streamSaver.createWriteStream(PNG_FILE.name.substring(0, PNG_FILE.name.lastIndexOf('.')) + '_packed.png');
    let writer = await stream.getWriter();

    await writer.write(PNG_HEADER); // Write the PNG header

    // Go through the parsed chunks
    for (let i=0; i<CHUNKS.length; i++) {
        let chunk = CHUNKS[i];
        if (chunk.header != PACKED_HEADER) {
            // Include this chunk in the output. Ignore any current packed chunk.
            if (chunk.header == 'IEND') {
                // Write the packed chunk just before the end of the file
                await writePackedChunk(writer);
            }
            await writer.write(await blobToInt8(PNG_FILE.slice(chunk.dataStart-8, chunk.dataEnd+4))); // Send this chunk to the output file
        }
    }
    writer.close();
}

/**
 * Write the contents of the packed chunk to stream
 * @param {WritableStreamDefaultWriter} writer 
 */
async function writePackedChunk(writer) {
    const headerBytes = chunkHeaderFromString(PACKED_HEADER);
    let file = FILES[0];
    let fileBytes = new Uint8Array(await file.arrayBuffer());
    let fileCRC = CRC32.buf(int8Concat(headerBytes, fileBytes));

    await writer.write(bytesFromInt(file.size, 4));
    await writer.write(headerBytes);
    await writer.write(fileBytes);
    await writer.write(bytesFromInt(fileCRC, 4));
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
    document.querySelector('.pack-button button').setAttribute('disabled', ''); // Disable pack button
    FILES = [];
    updateFilesList();
    document.querySelector('.image-preview img').setAttribute('src', ''); // Remove preview image
    //document.getElementById('imageupload').value = ''; // Clear image input box
}

async function filesChanged() {
    let filesUpload = document.getElementById('filesupload');
    let newFiles = filesUpload.files;
    for (let i=0; i<newFiles.length; i++) {
        FILES.push(newFiles[i]);
    }
    updateFilesList();
    filesUpload.value=''; // Clear files upload
}

function updateFilesList() {
    let fileList = document.querySelector('.file-list table tbody');

    // Delete listed files
    let listed = document.querySelectorAll('.file-list tr:not(.file-header)')
    for (let i=0; i<listed.length; i++) {
        listed[i].remove();
    }
    // Add new children
    for (let i=0; i<FILES.length; i++) {
        let childRow = document.createElement('tr');

        //Add File Name
        let nameCol = document.createElement('td');
        let nameP = document.createElement('p');
        let nameText = document.createTextNode(FILES[i].name);
        nameP.appendChild(nameText);
        nameCol.appendChild(nameP);

        // Add File Size
        let sizeCol = document.createElement('td');
        let sizeP = document.createElement('p');
        let sizeText = document.createTextNode(FILES[i].size);
        sizeP.appendChild(sizeText);
        sizeCol.appendChild(sizeP);

        // Add Removal Button
        let removeCol = document.createElement('td');
        let removeButton = document.createElement('button');
        let removeText = document.createTextNode('X');
        removeButton.setAttribute('onclick', `removeFile(${i});`)
        removeButton.appendChild(removeText);
        removeCol.appendChild(removeButton);

        // Append everything to table row
        childRow.appendChild(nameCol);
        childRow.appendChild(sizeCol);
        childRow.appendChild(removeCol);
        fileList.appendChild(childRow);
    }
}

/**
 * Remove the selected file and update list.
 * @param {Number} index 
 */
function removeFile(index) {
    FILES.splice(index, 1);
    updateFilesList();
}

/**
 * Convert chunk header bytes into a string.
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
 * Convert a chunk header string into bytes.
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
 * Convert an array of bytes to an integer.
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
 * Convert an integer to an array of bytes.
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

/**
 * Concatenate two Uint8Array objects
 * @param {Uint8Array} array1 
 * @param {Uint8Array} array2 
 * @returns {Uint8Array}
 */
function int8Concat(array1, array2) {
    let newArray = new Uint8Array(array1.length + array2.length);
    // Copy values over
    for (let i=0; i<array1.length; i++) {
        newArray[i] = array1[i];
    }
    for (let i=array1.length; i<newArray.length; i++) {
        newArray[i] = array2[i-array1.length];
    }
    return newArray;
}

/**
 * Convert a Blob to a Uint8Array
 * @param {Blob} blob 
 * @returns {Uint8Array}
 */
async function blobToInt8(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}