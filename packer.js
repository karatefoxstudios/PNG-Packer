var pngReader = new FileReader();
pngReader.onload = updateImageDetails;

const PNG_HEADER = [137, 80, 78, 71, 13, 10, 26, 10];

function test() {
    alert('Tested!');
}

function acceptImage() {
    let img = document.getElementById('fileupload').files[0];
    pngReader.readAsArrayBuffer(img);
}

function updateImageDetails() {
    let buffer = new Uint8Array(pngReader.result);
    // Quick test. Determine whether the uploaded image is a PNG or not.
    let correctHeader = true;
    for (let i=0; i<PNG_HEADER.length; i++) {
        if (PNG_HEADER[i] != buffer[i]) correctHeader = false;
    }
    alert("This is " + (correctHeader ? "" : "not ") + "a PNG image.");
}