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

    setPackingEnabled(true);

    // If PNG is under the preview limit, display it
    if (PNG_FILE.size < PREVIEW_LIMIT) {
        let reader = new FileReader();
        reader.onload = (event) => {
            let image = document.querySelector('.image-preview img');
            image.setAttribute('src', event.target.result);
        };
        reader.readAsDataURL(PNG_FILE);
    }
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
                if (FILES.length > 0) await writePackedChunk(writer);
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
    /*
    Packed Data Format:
    Len | Type | Info
    4   : uint : Length of the file name + file data
    n   : str  : Null-terminated string containing the file name
    n   :  X   | File data
    */
    const headerBytes = bytesFromString(PACKED_HEADER);

    let packedData = new Uint8Array();

    for (let i=0; i<FILES.length; i++) {
        let file = FILES[i];
        let name = file.name;
        let fileData = int8Concat(bytesFromString(name), new Uint8Array(1)); // Add name + null-termination
        let fileBytes = await blobToInt8(file);
        fileData = int8Concat(fileData, fileBytes); // Combine null-terminated string to file bytes
        fileData = int8Concat(bytesFromInt(fileData.length, 4), fileData); // Add the length of the data

        packedData = int8Concat(packedData, fileData);
    }
    let fileCRC = CRC32.buf(int8Concat(headerBytes, packedData));

    await writer.write(bytesFromInt(packedData.length, 4));
    await writer.write(headerBytes);
    await writer.write(packedData);
    await writer.write(bytesFromInt(fileCRC, 4));
}

/**
 * Updates FILES from packed data
 * @param {Uint8Array} packedData 
 */
async function loadPackedChunk(packedData) {
    let index = 0;
    while (index != packedData.length) {
        let dataLength = intFromBytes(packedData.slice(index, index+4));
        index += 4;
        let termIndex = packedData.slice(index).indexOf(0) + index;
        let fileName = stringFromBytes(packedData.slice(index, termIndex));
        let fileData = packedData.slice(termIndex+1, index+dataLength);
        index += dataLength;

        let file = new Blob([fileData]);
        file.name = fileName;
        FILES.push(file);
    }
    updateFilesList();
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
        let header = stringFromBytes(headerBytes);
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

        // If the chunk is packed, extract packed chunks
        if (header == PACKED_HEADER) {
            await loadPackedChunk(await readFileBytes(PNG_FILE, dataStart, dataEnd));
        }
    }
}


function imageNotPNG() {
    alert('This file is not a PNG!')
}

function resetAll() {
    PNG_FILE = undefined;
    CHUNKS = [];
    setPackingEnabled(false);
    FILES = [];
    updateFilesList();
    document.querySelector('.image-preview img').setAttribute('src', ''); // Remove preview image
    //document.getElementById('imageupload').value = ''; // Clear image input box
    setErrorMessage('');
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

        // Add Extract Button
        let extractCol = document.createElement('td');
        let extractButton = document.createElement('button');
        let extractText = document.createTextNode('Extract');
        extractButton.setAttribute('onclick', `extractFile(${i});`);
        extractButton.appendChild(extractText);
        extractCol.appendChild(extractButton);

        // Add Removal Button
        let removeCol = document.createElement('td');
        let removeButton = document.createElement('button');
        let removeText = document.createTextNode('Delete');
        removeButton.setAttribute('onclick', `removeFile(${i});`)
        removeButton.appendChild(removeText);
        removeCol.appendChild(removeButton);

        // Append everything to table row
        childRow.appendChild(nameCol);
        childRow.appendChild(sizeCol);
        childRow.appendChild(extractCol);
        childRow.appendChild(removeCol);
        fileList.appendChild(childRow);
    }
}

function setPackingEnabled(status) {
    let items = document.querySelectorAll('.pack-button *');
    for (let i=0; i<items.length; i++) {
        if (status) items[i].removeAttribute('disabled');
        else items[i].setAttribute('disabled', '');
    }
}

function setErrorMessage(msg) {
    item = document.getElementById('errormessage');
    brk = document.getElementById('errorbreak');
    if (msg) {
        item.removeAttribute('style');
        item.textContent = msg;
        brk.setAttribute('style', 'display: none;');
    } else {
        item.setAttribute('style', 'display: none;');
        brk.removeAttribute('style');
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
 * Extract the selected file
 * @param {Number} index 
 */
function extractFile(index) {
    let stream = streamSaver.createWriteStream(FILES[index].name, {size: FILES[index].length});
    new Response(FILES[index]).body.pipeTo(stream);
}

/**
 * Convert chunk header bytes into a string.
 * @param {Uint8Array} bytes
 * @returns {String}
 */
function stringFromBytes(bytes) {
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
function bytesFromString(headerString) {
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

resetAll();