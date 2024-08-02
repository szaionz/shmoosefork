document.addEventListener("DOMContentLoaded", () => {
    const fileUrl = 'subheadings/subheadings.txt'; // Replace with the URL of your .txt file
    const subheadingElement = document.getElementById('subheading');

    fetch(fileUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(text => {
            const lines = text.split('\n').filter(line => line.trim() !== ''); // Split by new lines and remove empty lines
            if (lines.length > 0) {
                const randomIndex = Math.floor(Math.random() * lines.length);
                const randomLine = lines[randomIndex];
                subheadingElement.textContent = randomLine;
            } else {
            }
        })
        .catch(error => {
            console.error('There was a problem with the fetch operation:', error);
        });
});