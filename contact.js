const contactForm = document.querySelector("#contact-form");
const contactStatus = document.querySelector("#contact-status");

if (contactForm && contactStatus) {
    const showStatus = (message, isError = false) => {
        contactStatus.textContent = message;
        contactStatus.classList.remove("hidden", "text-red-700", "text-cyanx");
        contactStatus.classList.add(isError ? "text-red-700" : "text-cyanx");
    };

    contactForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = contactForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.setAttribute("aria-busy", "true");

        try {
            const response = await fetch(contactForm.action, {
                method: "POST",
                body: new FormData(contactForm),
                headers: { Accept: "application/json" },
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "We couldn’t send your inquiry. Please try again.");
            }

            contactForm.reset();
            showStatus("Thanks! Your inquiry has been received. We’ll be in touch soon.");
        } catch (error) {
            showStatus(error.message || "We couldn’t send your inquiry. Please try again.", true);
        } finally {
            submitButton.disabled = false;
            submitButton.removeAttribute("aria-busy");
        }
    });
}
