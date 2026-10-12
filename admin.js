const loginPanel = document.querySelector("#login-panel");
const requestsPanel = document.querySelector("#requests-panel");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const requestsError = document.querySelector("#requests-error");
const requestsBody = document.querySelector("#requests-body");
const requestCount = document.querySelector("#request-count");
const logoutButton = document.querySelector("#logout-button");

async function getRequests() {
    const response = await fetch("/api/requests", { headers: { Accept: "application/json" } });
    if (response.status === 401) {
        loginPanel.classList.remove("hidden");
        requestsPanel.classList.add("hidden");
        logoutButton.classList.add("hidden");
        return;
    }
    if (!response.ok) throw new Error("Could not load requests. Please refresh and try again.");

    const requests = await response.json();
    requestsBody.replaceChildren();
    requestCount.textContent = `${requests.length} request${requests.length === 1 ? "" : "s"} (latest 500)`;
    requestsPanel.classList.remove("hidden");
    loginPanel.classList.add("hidden");
    logoutButton.classList.remove("hidden");

    if (requests.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.className = "px-4 py-8 text-center text-slate-500";
        cell.colSpan = 5;
        cell.textContent = "No quote requests yet.";
        row.append(cell);
        requestsBody.append(row);
        return;
    }

    for (const request of requests) {
        const row = document.createElement("tr");
        for (const value of [
            new Date(request.createdAt).toLocaleString(),
            request.name,
            request.mobile,
            request.type,
            request.address,
        ]) {
            const cell = document.createElement("td");
            cell.className = "max-w-sm whitespace-pre-wrap break-words px-4 py-4 align-top text-slate-600";
            cell.textContent = value;
            row.append(cell);
        }
        requestsBody.append(row);
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.classList.add("hidden");
    const form = new FormData(loginForm);

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                username: form.get("username"),
                password: form.get("password"),
            }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Sign in failed.");
        loginForm.reset();
        await getRequests();
    } catch (error) {
        loginError.textContent = error.message || "Sign in failed. Please try again.";
        loginError.classList.remove("hidden");
    }
});

logoutButton.addEventListener("click", async () => {
    try {
        const response = await fetch("/api/logout", { method: "POST" });
        if (!response.ok) throw new Error("Sign out failed. Please try again.");
        await getRequests();
    } catch (error) {
        requestsError.textContent = error.message;
        requestsError.classList.remove("hidden");
    }
});

getRequests().catch((error) => {
    requestsError.textContent = error.message || "Could not load requests.";
    requestsError.classList.remove("hidden");
});
