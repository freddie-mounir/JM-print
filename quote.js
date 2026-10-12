const quoteForm = document.querySelector("#quote-form");
const quoteStatus = document.querySelector("#quote-status");

if (quoteForm && quoteStatus) {
    const showStatus = (message, isError = false) => {
        quoteStatus.textContent = message;
        quoteStatus.classList.remove("hidden", "text-red-700", "text-cyanx");
        quoteStatus.classList.add(isError ? "text-red-700" : "text-cyanx");
    };

    if (new URLSearchParams(location.search).has("submitted")) {
        showStatus("Thanks! Your quote request has been received. We’ll be in touch soon.");
    }

    quoteForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = quoteForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.setAttribute("aria-busy", "true");

        try {
            const response = await fetch(quoteForm.action, {
                method: "POST",
                body: new FormData(quoteForm),
                headers: { Accept: "application/json" },
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "We couldn’t submit your request. Please try again.");
            }

            quoteForm.reset();
            showStatus("Thanks! Your quote request has been received. We’ll be in touch soon.");
        } catch (error) {
            showStatus(error.message || "We couldn’t submit your request. Please try again.", true);
        } finally {
            submitButton.disabled = false;
            submitButton.removeAttribute("aria-busy");
        }
    });
}
