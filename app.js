//firebase config which is still the same and the only project on firebase, not a new one (currently not used)
var firebaseConfig = {
    apiKey: "AIzaSyBBZrptsnMDFh25B0LvcBmp-n3CF0odUNA",
    authDomain: "artsee-42c23.firebaseapp.com",
    databaseURL: "https://artsee-42c23-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "artsee-42c23",
    storageBucket: "artsee-42c23.appspot.com",
    messagingSenderId: "587875980821",
    appId: "1:587875980821:web:51360fb6c025ffacd7e01c",
    measurementId: "G-CCQQ4RW6BG"
};
// Initialize Firebase
firebase.initializeApp(firebaseConfig);
let videoTrack = null;
var isProcessing = false; // Global flag to control interaction
let shouldRenderPredictions = true; //global flag to make sure while holding the screen, even if detections are made by the model, they are not drawn 

//the start of the function for real-time object detection given by roboflow but heavily modified
$(function () {
    const video = $("video")[0];
    var floatingMessage = document.getElementById("floatingMessage");
    var model;
    var cameraMode = "environment"; //uses the back camera, change to "user" to use the front camera
    var predictions = []; // the predictions detected in a frame are added to this variable
    var lastFrameTime = Date.now(); //variable to calculate fps
    var fps = 0;

    const startVideoStreamPromise = navigator.mediaDevices
        .getUserMedia({
            audio: false,
            video: {
                facingMode: cameraMode, //selected back camera
                height: { ideal: 1080 }, //set to the best video resolution for the available camera 
                width: { ideal: 1920 }
            }
        })
        .then(function (stream) {
            videoTrack = stream.getVideoTracks()[0]; //videoTrack used to set capabilities of the camera, such as exposure and zoom
            return new Promise(function (resolve) {
                video.srcObject = stream;
                video.onloadeddata = function () {
                    video.play();
                    resolve();
                };
            });
        });

    //roboflow information 
    var publishable_key = "rf_HET0H7EP4eUGNMnSe2V2ieF47Qa2"; //publishable key found on roboflow, choose a workspace -> settings -> Roboflow API
    var toLoad = {
        model: "paintings-ny5wj", //select a project and input the name
        version: 2 //version of the dataset which must have a trained model with that version of the dataset
    };

    //load the model
    const loadModelPromise = new Promise(function (resolve, reject) {
        roboflow
            .auth({
                publishable_key: publishable_key
            })
            .load(toLoad)
            .then(function (m) {
                model = m;
                resolve();
            });
    });

    //while the video stream is being prepared and the model is being loaded, the loading overlay is visible;
    //as soon as these are done, then the actions of resizeCanvas, detectFrame and hiding the loading overlay are started
    Promise.all([startVideoStreamPromise, loadModelPromise]).then(function () {
        resizeCanvas();
        detectFrame();
        var loadingMessage = document.getElementById('loadingMessage');
        var loadingText = document.getElementById('loadingText');
        if (loadingMessage) {
            loadingMessage.style.display = 'none'; //hides the loading message
            loadingText.style.display = 'none'; //as well as the text
        }

        //function that implements the zoom buttons
        $('.zoom-button').on('click', function () {
            // Remove 'selected' class from all buttons
            $('.zoom-button').removeClass('selected');
            // Add 'selected' class to clicked button
            $(this).addClass('selected');

            // Apply zoom based on button's ID
            if (this.id === 'zoomOut') {
                applyZoom(1); // 0x zoom
            } else if (this.id === 'zoomIn') {
                applyZoom(1.5); // 1.5x zoom
            } else if (this.id === 'zoomMid') {
                applyZoom(2); // 2x zoom
            }
        });


    });

    var canvas, ctx;

    //function that updates the centered top dynamic floating message
    function updateMessage(hasDetections) {

        //if there are any detections in the frame, then change the message to 'Press on the painting(s) for details', otherwhise change to 'Point at a painting'
        let newMessage = hasDetections
            ? "Press on the painting(s) for details"
            : "Point at a painting";

        if (floatingMessage.textContent !== newMessage) {
            floatingMessage.textContent = newMessage;

            // Add a brief animation
            floatingMessage.style.transform = 'translateX(-50%) scale(1.1)';

            setTimeout(() => {
                floatingMessage.style.transform = 'translateX(-50%) scale(1)';
            }, 200); // Reset after the animation duration
        }
    }

    //checking the cropped selected detection for development purposes, it saves the cropped png to the phone directly when a detection is either selected or manually cropped by holding the screen
    async function saveImage(imageData) {
        var overlay = document.getElementById('overlay');
        var fetchingDataMessage = document.getElementById('fetchingDataMessage');
        var fetchingDataText = document.getElementById('fetchingDataText');

        overlay.style.display = 'block'; // Show the overlay which blocks touches
        fetchingDataMessage.style.visibility = 'visible'; // Show the loading icon
        fetchingDataText.style.visibility = 'visible'; // Show the fetching message


        try {
            // Convert the base64 image data to a blob
            const fetchResponse = await fetch(imageData);
            const blob = await fetchResponse.blob();

            // Create a Blob URL for the blob
            const blobUrl = URL.createObjectURL(blob);

            // Create a temporary link element
            var tempLink = document.createElement('a');
            tempLink.style.display = 'none';
            tempLink.href = blobUrl;
            tempLink.download = 'image.png'; // Name of the file to be downloaded
            document.body.appendChild(tempLink);

            // Automatically start the download
            tempLink.click();

            // Clean up by revoking the Blob URL and removing the temporary link
            window.URL.revokeObjectURL(blobUrl);
            document.body.removeChild(tempLink);

            // Hide the blocking overlay and fetching message/icon
            overlay.style.display = 'none';
            fetchingDataMessage.style.visibility = 'hidden';
            fetchingDataText.style.visibility = 'hidden';

        } catch (error) {
            console.error('Error:', error);
            overlay.style.display = 'none';
            fetchingDataMessage.style.visibility = 'hidden';
            fetchingDataText.style.visibility = 'hidden';

        }
    }

    //function that sends the cropped png to the search_image API once a detection is either selected or manually cropped by holding the screen
    async function sendImageToFastAPIServer(imageData, startTime) {
        var overlay = document.getElementById('overlay');
        var fetchingDataMessage = document.getElementById('fetchingDataMessage');
        var fetchingDataText = document.getElementById('fetchingDataText');

        overlay.style.display = 'block'; // Show the overlay
        fetchingDataMessage.style.visibility = 'visible'; // Show the loading icon
        fetchingDataText.style.visibility = 'visible'; // Show the fetching message


        // Create a FormData instance
        var formData = new FormData();
        // Convert the base64 image data to a blob
        const fetchResponse = await fetch(imageData);
        const blob = await fetchResponse.blob();
        // Append the blob as 'file', which is the expected field name for the file upload
        formData.append('file', blob, 'image.png');
        let endTime = performance.now(); // End the timer which decides how long the png took to be prepared from the moment its selected


        // Send the request to the FastAPI server
        try {
            let startTime2 = performance.now(); // Start the timer which decides how long the communication with the API takes
            let response = await fetch('https://api.artvista.app/artwork_search_main/', {
                method: 'POST',
                body: formData // FormData will be sent as 'multipart/form-data'
            });
            if (response.ok) { //if response is received

                let json = await response.json();
                console.log(JSON.stringify(json));
                let endTime2 = performance.now(); // End the timer which decides how long the communication with the API takes
                console.log(`Time taken to prepare the image: ${endTime - startTime} ms`); // Log the time taken for the png to be processed 
                console.log(`Time taken to receive the json: ${endTime2 - startTime2} ms`); // Log the time taken to communicate with the API

                //only send the json to the react native app if the imaginary confidence is above 2
                var paintingName = json.result[1];
                var author = json.result[2];
                var conf = json.imaginary_confidence;
                var currentDate = new Date();
                var hours = currentDate.getHours();
                var minutes = currentDate.getMinutes();
                var seconds = currentDate.getSeconds();

                //displaying the detected painting on screen as well
                var displayMessage = "Last painting detected at: " + hours + ":" + minutes + ":" + seconds + "<br>Painting: " + paintingName + "<br>Author: " + author + "<br>Imaginary confidence: " + conf;

                var infoDisplay = document.getElementById('infoDisplay');
                infoDisplay.innerHTML = displayMessage;

                // this sends the json to react native if it is detected that the web app runs in ReactNativeWebView which is the react native browser
                if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify(json));
                }

                //once the json is fetched and sent to react native, the fetchind data overlay is hidden but we first set a 500ms timer to acount for the animation in react native between screens
                await new Promise(resolve => setTimeout(resolve, 500)); // 1000 ms = 1 second
                overlay.style.display = 'none';
                fetchingDataMessage.style.visibility = 'hidden';
                fetchingDataText.style.visibility = 'hidden';

            } else {
                // Handle HTTP errors
                console.error('Server response was not ok.');
                await new Promise(resolve => setTimeout(resolve, 500)); // 1000 ms = 1 second
                overlay.style.display = 'none';
                fetchingDataMessage.style.visibility = 'hidden';
                fetchingDataText.style.visibility = 'hidden';


            }

        } catch (error) {
            console.error('Error:', error);
            await new Promise(resolve => setTimeout(resolve, 500)); // 1000 ms = 1 second
            overlay.style.display = 'none';
            fetchingDataMessage.style.visibility = 'hidden';
            fetchingDataText.style.visibility = 'hidden';


        }
    }



    function videoDimensions(video) {
        // Ratio of the video's intrisic dimensions
        var videoRatio = video.videoWidth / video.videoHeight;

        // The width and height of the video element
        var width = video.offsetWidth,
            height = video.offsetHeight;

        // The ratio of the element's width to its height
        var elementRatio = width / height;

        // If the video element is short and wide
        if (elementRatio > videoRatio) {
            width = height * videoRatio;
        } else {
            // It must be tall and thin, or exactly equal to the original ratio
            height = width / videoRatio;
        }

        return {
            width: width,
            height: height
        };
    }

    $(window).resize(function () {
        resizeCanvas();
    });

    //function that cropps the center of the screen for the manual detections
    function cropAndSaveCenterOfVideo() {
        const tempCanvas = document.createElement('canvas'); //creates a temp canvas which the cropped image is drawn on
        const tempCtx = tempCanvas.getContext('2d');
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        const startTime = performance.now(); // Start the timer

        // Setting the dimensions for the cropped area (center of the video)
        const cropWidth = videoWidth / 2;
        const cropHeight = videoHeight / 4;
        const sourceX = videoWidth / 4;
        const sourceY = videoHeight / 3;

        tempCanvas.width = cropWidth;
        tempCanvas.height = cropHeight;

        tempCtx.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight); //drawing the image on the temp canvas 

        const croppedImageData = tempCanvas.toDataURL('image/png'); //saved as a png
        sendImageToFastAPIServer(croppedImageData, startTime); //sending it to the api for processing 
        //saveImage(croppedImageData);
    }


    //function that draws the overlay when holding the screen
    function showBlackScreenOverlay(overlay) {
        if (!overlay) return; // Ensure overlay is present

        // Remove any existing canvas from the overlay
        while (overlay.firstChild) {
            overlay.removeChild(overlay.firstChild);
        }

        // Make the overlay visible
        overlay.style.visibility = 'visible';
        floatingMessage.style.visibility = 'hidden';

        // Create and append a new canvas element
        const canvas = document.createElement('canvas');
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        canvas.width = videoWidth;
        canvas.height = videoHeight;
        overlay.appendChild(canvas);

        // Ensure valid dimensions
        if (canvas.width === 0 || canvas.height === 0) {
            console.error("Invalid overlay dimensions");
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error("Failed to get canvas context");
            return;
        }

        // Function to apply blur effect
        const applyBlurEffect = () => {

            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; // Semi-transparent white
            ctx.fillRect(0, 0, canvas.width, canvas.height); // Cover entire canvas
        };

        const drawRoundedCorners = (x, y, width, height, radius) => {
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 5;

            // Top left corner
            ctx.beginPath();
            ctx.arc(x + radius, y + radius, radius, Math.PI, 1.5 * Math.PI);
            ctx.stroke();

            // Top right corner
            ctx.beginPath();
            ctx.arc(x + width - radius, y + radius, radius, 1.5 * Math.PI, 2 * Math.PI);
            ctx.stroke();

            // Bottom right corner
            ctx.beginPath();
            ctx.arc(x + width - radius, y + height - radius, radius, 0, 0.5 * Math.PI);
            ctx.stroke();

            // Bottom left corner
            ctx.beginPath();
            ctx.arc(x + radius, y + height - radius, radius, 0.5 * Math.PI, Math.PI);
            ctx.stroke();
        };


        // Countdown logic
        let countdown = 3;
        const drawCountdown = () => {
            if (countdown > 0) {
                // Apply blur effect
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                applyBlurEffect();

                // Draw the rectangle for the cropped area without blur
                const cornerRadius = 80; // Same as the radius used in drawRoundedCorners
                const cropWidth = videoWidth / 2;
                const cropHeight = videoHeight / 4;
                const sourceX = videoWidth / 4;
                const sourceY = videoHeight / 3;

                ctx.globalCompositeOperation = 'destination-out';
                ctx.beginPath();
                ctx.moveTo(sourceX + cornerRadius, sourceY);
                ctx.lineTo(sourceX + cropWidth - cornerRadius, sourceY);
                ctx.arc(sourceX + cropWidth - cornerRadius, sourceY + cornerRadius, cornerRadius, 1.5 * Math.PI, 2 * Math.PI);
                ctx.lineTo(sourceX + cropWidth, sourceY + cropHeight - cornerRadius);
                ctx.arc(sourceX + cropWidth - cornerRadius, sourceY + cropHeight - cornerRadius, cornerRadius, 0, 0.5 * Math.PI);
                ctx.lineTo(sourceX + cornerRadius, sourceY + cropHeight);
                ctx.arc(sourceX + cornerRadius, sourceY + cropHeight - cornerRadius, cornerRadius, 0.5 * Math.PI, Math.PI);
                ctx.lineTo(sourceX, sourceY + cornerRadius);
                ctx.arc(sourceX + cornerRadius, sourceY + cornerRadius, cornerRadius, Math.PI, 1.5 * Math.PI);
                ctx.fill();


                // Reset to default composite operation
                ctx.globalCompositeOperation = 'source-over';

                // Optionally, redraw the border of the rectangle with rounded corners
                drawRoundedCorners(sourceX, sourceY, cropWidth, cropHeight, cornerRadius);
                // Draw the countdown number
                ctx.font = '300px Arial';
                ctx.fillStyle = 'white';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(countdown, canvas.width / 2, canvas.height / 1.2);
                ctx.font = '50px Arial';
                ctx.fillText("Keep holding", canvas.width / 2, canvas.height / 4);

                countdown--;
                setTimeout(drawCountdown, 1000);
            }
        };

        drawCountdown();
    }


    //timer for when the crop is being done when holding the screen(4s)
    let touchStartTimer_crop = null;
    //timer for how long it takes for the png to be proccesed when selecting a detected painting
    let touchStartTime = 0;
    //timer for when the manual detection screen should pop up(1s)
    let touchStartTimer_blackscreen = null;

    function handleCanvasInteraction(event) {
        event.preventDefault();
        const startTime = performance.now(); // Start the timer
        const overlay = document.getElementById('blackScreenOverlay');

        let x, y;
        const rect = canvas[0].getBoundingClientRect();

        //if the screen is tapped
        if (event.type === 'touchstart') {
            touchStartTime = new Date().getTime(); // Record the time when the touch starts
            const touch = event.changedTouches[0];
            //get coordonates of the tap
            x = touch.clientX - rect.left;
            y = touch.clientY - rect.top;

            // Set a timer for 4 seconds to call cropAndSaveCenterOfVideo
            touchStartTimer_crop = setTimeout(() => {

                cropAndSaveCenterOfVideo();
                overlay.style.visibility = 'hidden';
                floatingMessage.style.visibility = 'visible';
                shouldRenderPredictions = true; // Re-enable rendering predictions
            }, 4000);

            // Set a timer for 1 seconds to display the manual detection overlay

            touchStartTimer_blackscreen = setTimeout(() => {
                if (ctx) {
                    ctx.clearRect(0, 0, canvas[0].width, canvas[0].height);
                }

                shouldRenderPredictions = false; // Disable rendering predictions
                showBlackScreenOverlay(overlay);
            }, 1000);

        }
        //if the tap or hold ended, get rid of all timers and overlays
        else if (event.type === 'touchend') {
            clearTimeout(touchStartTimer_crop);
            clearTimeout(touchStartTimer_blackscreen);
            shouldRenderPredictions = true; // Re-enable rendering predictions

            overlay.style.visibility = 'hidden';
            floatingMessage.style.visibility = 'visible';

        }
        else {
            //if its a click on the PC, still get the coordonates
            x = event.clientX - rect.left;
            y = event.clientY - rect.top;
        }

        // Adjust coordinates based on the scale factor
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;
        x = x * scaleX;
        y = y * scaleY;

        // Existing logic to find which rectangle was clicked or touched
        const clickedPrediction = predictions.find(p =>
            x > (p.bbox.x - p.bbox.width / 2) &&
            x < (p.bbox.x + p.bbox.width / 2) &&
            y > (p.bbox.y - p.bbox.height / 2) &&
            y < (p.bbox.y + p.bbox.height / 2));

        if (clickedPrediction) {

            //start drawing the selected painting on the canvas and save it as a png for the API
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = clickedPrediction.bbox.width;
            tempCanvas.height = clickedPrediction.bbox.height;
            const tempCtx = tempCanvas.getContext('2d');

            // Adjust these values based on how your predictions are scaled to the video element
            const scaleX = video.videoWidth / canvas[0].width;
            const scaleY = video.videoHeight / canvas[0].height;
            const sourceX = (clickedPrediction.bbox.x - clickedPrediction.bbox.width / 2) * scaleX;
            const sourceY = (clickedPrediction.bbox.y - clickedPrediction.bbox.height / 2) * scaleY;
            const sourceWidth = clickedPrediction.bbox.width * scaleX;
            const sourceHeight = clickedPrediction.bbox.height * scaleY;

            tempCtx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, tempCanvas.width, tempCanvas.height);

            const dataURL = tempCanvas.toDataURL('image/png');
            sendImageToFastAPIServer(dataURL, startTime);
            //saveImage(dataURL);

        }
    }


    const resizeCanvas = function () {
        $("canvas").remove();

        canvas = $("<canvas/>");

        ctx = canvas[0].getContext("2d");

        var dimensions = videoDimensions(video);

        console.log(
            video.videoWidth,
            video.videoHeight,
            video.offsetWidth,
            video.offsetHeight,
            dimensions
        );

        canvas[0].width = video.videoWidth;
        canvas[0].height = video.videoHeight;

        canvas.css({
            width: dimensions.width,
            height: dimensions.height,
            left: ($(window).width() - dimensions.width) / 2,
            top: ($(window).height() - dimensions.height) / 2
        });

        $("body").append(canvas);



        canvas.on('click', handleCanvasInteraction);
        canvas.on('touchstart', handleCanvasInteraction);
        canvas.on('touchend', handleCanvasInteraction);

    };

    //the shape of the detected painting
    function roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    //render on canvas all the detected paintings
    const renderPredictions = function (predictions) {
        var customText = 'Painting'; // the text which appears along with the rectangle
        var scale = 1;

        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        updateMessage(predictions.length > 0);

        //for each detection in the predictions variable, draw a rectangke
        predictions.forEach(function (prediction) {
            const x = prediction.bbox.x;
            const y = prediction.bbox.y;
            const width = prediction.bbox.width;
            const height = prediction.bbox.height;

            // Gradient stroke for rectangle
            const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
            gradient.addColorStop(0, "white");
            gradient.addColorStop(0.1, "black");

            // Rounded rectangle with shadow for detection box
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetX = 5;
            ctx.shadowOffsetY = 5;
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 4;
            roundRect(ctx, (x - width / 2) / scale, (y - height / 2) / scale, width / scale, height / scale, 20);
            ctx.stroke();

            // Fill the rectangle with a semi-transparent color
            ctx.fillStyle = "rgba(0, 0, 0, 0.2)"; // Adjust the alpha for transparency level
            ctx.fill(); // Fill the rounded rectangle

            let fontSize = 18; // Starting font size
            ctx.font = "italic bold " + fontSize + "px Times New Roman";
            let textWidth = ctx.measureText(customText).width;

            // Dynamically adjust the font size of the text to fit the rectangle width
            while (textWidth > width - 10 && fontSize > 8) { // Ensure some padding and minimum font size
                fontSize--;
                ctx.font = "italic bold " + fontSize + "px Times New Roman";
                textWidth = ctx.measureText(customText).width;
            }

            // Text with transparent background, positioned inside and centered at the top of the rectangle
            ctx.textBaseline = "top";
            ctx.fillStyle = "white";
            ctx.fillText("FPS: " + fps.toFixed(2), 10, 20); //display the fps on the canvas as well
            const textX = (x - textWidth / 2) / scale; // Center text inside the rectangle
            const textY = (y - height / 2) / scale + 4; // Adjust Y position to be at the top inside the rectangle
            ctx.fillText(customText, textX, textY); // Draw text inside the rectangle

            ctx.restore();
        });
    };

    //use the model on the video stream to detect objects
    const detectFrame = function () {
        if (!model) return requestAnimationFrame(detectFrame);
        model.configure({ threshold: 0.8 }); //change the threshold of detections
        model.detect(video).then(function (preds) {
            predictions = preds;
            if (shouldRenderPredictions) { //if not holding the screen, then draw detections
                renderPredictions(predictions);
            }

            // Calculate FPS
            var now = Date.now();
            var elapsed = now - lastFrameTime;
            if (elapsed > 0) {
                fps = 1000 / elapsed;
            }
            lastFrameTime = now;

            // Call next frame
            requestAnimationFrame(detectFrame);
        }).catch(function (e) {
            console.log("CAUGHT", e);
            requestAnimationFrame(detectFrame);
        });
    };


    document.getElementById('exposureDefault').addEventListener('click', function () {
        applyExposure('default'); // Set to default exposure
    });

    document.getElementById('exposureMax').addEventListener('click', function () {
        applyExposure('max'); // Set to maximum exposure
    });


});


//function that applies zoom level based on the selected button
async function applyZoom(zoomLevel) {
    if (!videoTrack) {
        console.error('Video track is not available');
        return;
    }

    try {
        const capabilities = videoTrack.getCapabilities();

        // Check if zoom is supported
        if (!capabilities.zoom) {
            console.log('Zoom is not supported by this device');
            return;
        }

        // Apply the zoom constraint
        await videoTrack.applyConstraints({
            advanced: [{ zoom: zoomLevel }]
        });
    } catch (error) {
        console.error('Error applying zoom:', error);
    }
}

//function that applies exposure level based on the selected button
async function applyExposure(action) {
    if (!videoTrack) {
        console.error('Video track is not available');
        return;
    }

    try {
        const capabilities = videoTrack.getCapabilities();
        if (!capabilities.exposureCompensation) {
            console.log('Exposure compensation is not supported by this device');
            return;
        }

        let newExposureCompensation;
        if (action === 'default') {
            newExposureCompensation = 0; // Default value
        } else if (action === 'max') {
            newExposureCompensation = capabilities.exposureCompensation.max; // Max value
        }

        console.log('Setting Exposure Compensation to:', newExposureCompensation);
        await videoTrack.applyConstraints({
            advanced: [{ exposureCompensation: newExposureCompensation }]
        });

    } catch (error) {
        console.error('Error applying exposure compensation:', error);
    }
}
