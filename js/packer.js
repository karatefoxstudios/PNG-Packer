if (typeof streamSaver == 'undefined') throw new Error('StreamSaver not loaded!');
if (typeof CRC32 == 'undefined') throw new Error('CRC32 not loaded!');
if (typeof forge == 'undefined') throw new Error('Forge not loaded!');

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

/**
 * Scan the current PNG target for files
 * @param {String} Password to use for decryption
 * @returns {Object} Error data
 *  - Code -1: Tried blank password, but PNG is password-protected (not really even an error)
 *  - Code 0: Incorrect Password
 *  - Code 1: Invalid File
 */
async function imageChanged(password) {
    resetAll();
    PNG_FILE = document.getElementById('imageupload').files[0];
    var name = PNG_FILE.name;
    var size = utils.humanFileSize(PNG_FILE.size);

    let fileHeader = await readFileBytes(PNG_FILE, 0, 8);
    for (let i=0; i<PNG_HEADER.length; i++) {
        if (PNG_HEADER[i] != fileHeader[i]) {
            return {code:1,message:"This file is not a PNG"};
        }
    }

    console.log('Trying to locate chunks');
    // The file matches the PNG header.
    if (!await locateChunks(password)){
        if(!password){
            // Tried blank password, but PNG is password-protected
            return {code:-1,message:"This PNG is password protected"};
        }
        else{
            // Attempted password was incorrect
            return {code:0,message:"The password you provided was incorrect."};
        }
    }


    // If PNG is under the preview limit, display it
    let image_caption = document.getElementById("image-preview-caption");
    if (PNG_FILE.size < PREVIEW_LIMIT) {
        let reader = new FileReader();
        reader.onload = (event) => {
            let image = document.querySelector('.image-preview img');
            image.setAttribute('src', event.target.result);
            image_caption.innerText = "Loaded " + name + " (" + size + ")";
        };
        reader.readAsDataURL(PNG_FILE);
    } else{
        image_caption.innerText = "[PNG file to big to display preview]";
    }
    return null; // No error
}

/**
 * Packs the files into the PNG
 * @param {String} the password to use
 */
async function packFiles(password) {
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
                if (FILES.length > 0) await writePackedChunk(writer, password);
            }
            await writer.write(await blobToInt8(PNG_FILE.slice(chunk.dataStart-8, chunk.dataEnd+4))); // Send this chunk to the output file
        }
    }
    writer.close();
}

/**
 * Write the contents of the packed chunk to stream
 * @param {WritableStreamDefaultWriter} writer
 * @param {String} the password to use
 */
async function writePackedChunk(writer, password) {
    /*
    Packed Data Format:
    Len | Type | Info
    16   :  X   : Salt for key derivation
    16  :  X   : Initialization Vector for AES-CBC
    32  :  X   : HMAC
    --------------------Encrypted Data---------------------------
    4   : uint : Length of the file name
    n   : str  : String containing the file name
    4   : uint : Length of the file data
    n   :  X   : File data
    */
    const headerBytes = ENCODER.encode(PACKED_HEADER);

    let packedData = new Uint8Array();
    let salt = forge.random.getBytesSync(16);
    let iv = forge.random.getBytesSync(16);
    let passwordOmitted = password == "" || password == undefined;
    password = passwordOmitted ? DEFAULT_PASSWORD : password; // Force default password if none given
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
    cipher.update(buffer);
    cipher.finish();

    let encData = cipher.output.getBytes();
    let hmac = computeHMAC(encData, key);

    let saltBytes = forgeToInt8(salt);
    let ivBytes = forgeToInt8(iv);
    let encDataBytes = forgeToInt8(encData);
    let hmacBytes = forgeToInt8(hmac);

    let outBytes = int8Concat(headerBytes, saltBytes);
    outBytes = int8Concat(outBytes, ivBytes);
    outBytes = int8Concat(outBytes, hmacBytes);
    outBytes = int8Concat(outBytes, encDataBytes);

    let fileCRC = CRC32.buf(outBytes);

    await writer.write(bytesFromInt(encDataBytes.length+64, 4));
    await writer.write(outBytes);
    await writer.write(bytesFromInt(fileCRC, 4));
}

/**
 * Updates FILES from packed data
 * @param {Uint8Array} encDataBytes
 * @param {String} password to use
 * * @returns {Boolean} Was successful? (Password correct)
 */
async function loadPackedChunk(encDataBytes, password) {
    let saltBytes = encDataBytes.slice(0, 16);
    let ivBytes = encDataBytes.slice(16, 32);
    let hmacBytes = encDataBytes.slice(32, 64);
    password = password ? password : DEFAULT_PASSWORD; // Force default password if none given
    encDataBytes = encDataBytes.slice(64);

    let salt = int8ToForge(saltBytes);
    let iv = int8ToForge(ivBytes);
    let encData = int8ToForge(encDataBytes);
    let hmac = int8ToForge(hmacBytes);

    let key = deriveKey(password, salt);
    let hmac_calculated = computeHMAC(encData, key);

    if (hmac_calculated != hmac) return false;

    let decipher = forge.cipher.createDecipher('AES-CBC', key);
    decipher.start({iv: iv});
    decipher.update(forge.util.createBuffer(encData));
    if (!decipher.finish()) return false;

    let buffer = decipher.output;

    while (!buffer.isEmpty()) {
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
    return true;
}

/**
 * Compute the HMAC of the data
 * @param {String} data
 * @param {String} key
 * @returns {String} The 32 bit HMAC
 */
function computeHMAC(data, key) {
    let hmac = forge.hmac.create();
    hmac.start('sha256', key);
    hmac.update(data);
    return hmac.digest().getBytes();
}

function forgeToInt8(str) {
    let buf = forge.util.createBuffer(str);
    return bufferToInt8(buf, buf.length());
}

function int8ToForge(bytes) {
    let buf = forge.util.createBuffer(bytes);
    return buf.getBytes();
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
 * @param {String} the password to use
 * @returns {Boolean} Was successful? (Password correct)
 */
async function locateChunks(password) {
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
            if (!await loadPackedChunk(await readFileBytes(PNG_FILE, dataStart, dataEnd), password)) {
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
    let listed = document.querySelectorAll('.file-list tr')
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
        let fileSizeText = utils.humanFileSize(FILES[i].size, true);
        let sizeText = document.createTextNode(fileSizeText);
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
    setPackingEnabled(FILES.length > 0);
}

function setPackingEnabled(status) {
    let items = document.querySelectorAll('.pack-button');
    for (let i=0; i<items.length; i++) {
        if (status) items[i].removeAttribute('disabled');
        else items[i].setAttribute('disabled', '');
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