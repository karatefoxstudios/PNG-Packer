const PNG_HEADER = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PACKED_HEADER = 'paCk';
const PREVIEW_LIMIT = 35840000;
const DEFAULT_PASSWORD = 'default';

/** @type {File} */
var PNG_FILE;
/** @type {Array} */
var CHUNKS = [];
/** @type {Array} */
var FILES = [];

var ENCODER = new TextEncoder();
var DECODER = new TextDecoder();

async function imageChanged() {
    resetAll();
    PNG_FILE = document.getElementById('imageupload').files[0];
    
    let fileHeader = await readFileBytes(PNG_FILE, 0, 8);
    for (let i=0; i<PNG_HEADER.length; i++) {
        if (PNG_HEADER[i] != fileHeader[i]) {
            setErrorMessage('This file is not a PNG.');
            return;
        }
    }

    console.log('Trying to locate chunks');
    // The file matches the PNG header.
    if (!await locateChunks()) return; // If password is incorrect, stop

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
    1   : uint : Length of salt
    ?   :  X   : Salt for key derivation
    1   : uint : Lengh of IV
    16  :  X   : Initialization Vector for AES-CBC
    --------------------Encrypted Data---------------------------
    4   : uint : Length of the file name
    n   : str  : String containing the file name
    4   : uint : Length of the file data
    n   :  X   : File data
    */
    const headerBytes = ENCODER.encode(PACKED_HEADER);

    let packedData = new Uint8Array();
    let password = document.getElementById('packpassword').value;
    let salt = forge.random.getBytesSync(16);
    let iv = forge.random.getBytesSync(16);

    password = password ? password : DEFAULT_PASSWORD; // Force default password if none given
    let key = deriveKey(password, salt);

    for (let i=0; i<FILES.length; i++) {
        let file = FILES[i];
        let name = file.name;
        let fileData = int8Concat(bytesFromInt(name.length, 4), ENCODER.encode(name)); // Add name length + name
        let fileBytes = await blobToInt8(file);
        fileData = int8Concat(fileData, bytesFromInt(fileBytes.length, 4)); // Add file length data
        fileData = int8Concat(fileData, fileBytes); // Add the file data

        packedData = int8Concat(packedData, fileData);
    }

    // Encrypt packedData
    let cipher = forge.cipher.createCipher('AES-CBC', key);
    cipher.start({iv: iv});
    let buffer = forge.util.createBuffer(packedData);
    console.log('Buffer:');
    console.log(buffer);
    cipher.update(buffer);
    cipher.finish();
    
    let encData = cipher.output.getBytes();

    let saltUtf8 = forge.util.encodeUtf8(salt);
    let ivUtf8 = forge.util.encodeUtf8(iv);
    let encDataUtf8 = forge.util.encodeUtf8(encData);

    let saltBytes = ENCODER.encode(saltUtf8);
    let ivBytes = ENCODER.encode(ivUtf8);
    let encDataBytes = ENCODER.encode(encDataUtf8);
    let saltLenBytes = bytesFromInt(saltBytes.length, 1);
    let ivLenBytes = bytesFromInt(ivBytes.length, 1);

    console.log('Enc Salt:');
    console.log(saltBytes);
    console.log('Enc IV:');
    console.log(ivBytes);
    console.log('Enc Pass:');
    console.log(password);
    console.log('Enc Key:');
    console.log(key);
    console.log('Enc Data:');
    console.log(encDataBytes);
    console.log('Packed Data [0:10]');
    console.log(packedData.slice(0, 10));

    let outBytes = int8Concat(headerBytes, saltLenBytes);
    outBytes = int8Concat(outBytes, saltBytes);
    outBytes = int8Concat(outBytes, ivLenBytes);
    outBytes = int8Concat(outBytes, ivBytes);
    outBytes = int8Concat(outBytes, encDataBytes);

    let fileCRC = CRC32.buf(outBytes);

    await writer.write(bytesFromInt(encDataBytes.length+saltBytes.length+ivBytes.length+2, 4));
    await writer.write(outBytes);
    await writer.write(bytesFromInt(fileCRC, 4));
}

/**
 * Updates FILES from packed data
 * @param {Uint8Array} encDataBytes 
 * @returns {Boolean} Was successful? (Password correct)
 */
async function loadPackedChunk(encDataBytes) {
    let saltLen = intFromBytes(encDataBytes.slice(0, 1));
    let saltUtf8 = DECODER.decode(encDataBytes.slice(1, saltLen+1));
    let ivLen = intFromBytes(encDataBytes.slice(1+saltLen, 2+saltLen));
    let ivUtf8 = DECODER.decode(encDataBytes.slice(2+saltLen, 2+saltLen+ivLen));
    let password = document.getElementById('pngpassword').value;
    password = password ? password : DEFAULT_PASSWORD; // Force default password if none given
    encDataUtf8 = DECODER.decode(encDataBytes.slice(2+saltLen+ivLen));

    let salt = forge.util.decodeUtf8(saltUtf8);
    let iv = forge.util.decodeUtf8(ivUtf8);
    let encData = forge.util.decodeUtf8(encDataUtf8);

    let key = deriveKey(password, salt);

    console.log('Dec Salt:')
    console.log(ENCODER.encode(saltUtf8));
    console.log('Dec IV:')
    console.log(ENCODER.encode(ivUtf8));
    console.log('Dec Pass:')
    console.log(password);
    console.log('Dec Key:')
    console.log(key);
    console.log('Enc Data:');
    console.log(ENCODER.encode(encDataUtf8));

    let decipher = forge.cipher.createDecipher('AES-CBC', key);
    decipher.start({iv: iv});
    decipher.update(forge.util.createBuffer(encData));
    if (!decipher.finish()) return false;

    console.log('Success!');

    let buffer = decipher.output;
    console.log('Buffer');
    console.log(buffer);

    while (!buffer.isEmpty()) {
        console.log('New file!');
        let nameLength = buffer.getInt32();
        let nameStr = buffer.getBytes(nameLength);
        let nameUtf8 = forge.util.encodeUtf8(nameStr);
        let fileLength = buffer.getInt32();
        let fileBytes = bufferToInt8(buffer, fileLength);
        let file = new Blob([fileBytes]);
        file.name = nameUtf8;
        FILES.push(file);
    }

    updateFilesList();
    console.log('Done loading!');
    return true;
}

function bufferToInt8(buffer, count) {
    array = [];
    for (let i=0; i<count; i++) {
        array.push(buffer.getInt(8));
    }
    return new Uint8Array(array);
}

/**
 * Perform key derivation
 * @param {String} password 
 * @param {String} salt 
 * @returns {String} The derived key
 */
function deriveKey(password, salt) {
    let key = forge.pkcs5.pbkdf2(password, salt, 100000, 16);
    return key;
}

/**
 * Locate the chunks in the PNG image
 * @returns {Boolean} Was successful? (Password correct)
 */
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
        let header = DECODER.decode(headerBytes);
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
            if (!await loadPackedChunk(await readFileBytes(PNG_FILE, dataStart, dataEnd))) {
                setErrorMessage('The password is incorrect!');
                return false;
            };
        }
    }
    return true;
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
        removeButton.setAttribute('onclick', `removeFile(${i});`);
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


/*
// TEST

let password = 'this is my password it is really long';
let data = 'hello there';
let salt = forge.random.getBytesSync(16);
let iv = forge.random.getBytesSync(16);
let key = deriveKey(password, salt);

let cipher = forge.cipher.createCipher('AES-CBC', key);
cipher.start({iv:iv});
cipher.update(forge.util.createBuffer(data));
cipher.finish();
let enc = cipher.output.data;

//key = forge.random.getBytesSync(16);

let decipher = forge.cipher.createDecipher('AES-CBC', key);
decipher.start({iv:iv});
decipher.update(forge.util.createBuffer(enc));
console.log(decipher.finish());

console.log(decipher.output.data);
*/