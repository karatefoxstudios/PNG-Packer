switchScreenTo("png-selection");

async function readyToPack(){
	let password = document.getElementById("packpassword").value;
	clearErrorMessage();
	switchScreenTo("loading");
	try{
		await packFiles(password);
		switchScreenTo("finish");
	}
	catch(e){
		switchScreenTo("info");
		setErrorMessage(e);
	}
}

async function pngUploaded(){
	clearErrorMessage();
	var password = document.getElementById("pngpassword").value;
	switchScreenTo("loading");
	var error = await imageChanged(password);
	if(error == null){
		switchScreenTo("info");
	}
	else{
		if(error.code > 0){
			// An actual fatal error occurred.
			setErrorMessage(error.message);
			switchScreenTo("png-selection");
		}
		else if(error.code == -1){
			// Just needs a password
			switchScreenTo("passwordGuess");
		}
		else if(error.code == 0){
			// The provided password was incorrect
			switchScreenTo("passwordGuess");
			setErrorMessage(error.message)
		}

	}
}

function clearErrorMessage(){
	var err = document.getElementById("errormessage");
	err.style.display = "none";
}

function setErrorMessage(msg) {
	var err = document.getElementById("errormessage");
	err.style.display = "block";
	err.innerText = msg;
}

function switchScreenTo(id){
	var container = document.getElementById("demoContainer");
	// Hide all screens
	for(var i=0;i<container.children.length;i++){
		container.children[i].style.display = "none";
	}
	// Make one screen visible
	var target = container.querySelector("[screen=" + id + "]");
	if(!target){
		throw Error("Could not switch to screen: " + id);
	}
	target.style.display = "block";
}