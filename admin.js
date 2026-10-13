const loginPanel = document.querySelector("#login-panel");
const requestsPanel = document.querySelector("#requests-panel");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const requestsError = document.querySelector("#requests-error");
const requestsBody = document.querySelector("#requests-body");
const requestCount = document.querySelector("#request-count");
const logoutButton = document.querySelector("#logout-button");
const menuButton = document.querySelector("[data-menu-button]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const quoteStatuses = ["new", "pending", "done", "delivered"];

menuButton.addEventListener("click", () => {
    const isExpanded = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isExpanded));
    mobileMenu.classList.toggle("hidden");
});

function getErrorMessage(error, fallback) {
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object" && typeof error.message === "string" && error.message.trim()) {
        return error.message;
    }
    return fallback;
}

function setStatusChip(select, status) {
    select.className = `status-chip status-chip-${status}`;
}

async function getRequests() {
    const response = await fetch("/api/requests", { headers: { Accept: "application/json" } });
    if (response.status === 401) {
        loginPanel.classList.remove("hidden");
        requestsPanel.classList.add("hidden");
        logoutButton.classList.add("hidden");
        return;
    }
    if (!response.ok) throw new Error("Could not load requests. Please refresh and try again.");
    requestsError.classList.add("hidden");

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
        cell.colSpan = 8;
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
            request.description,
            request.address,
        ]) {
            const cell = document.createElement("td");
            cell.className = "max-w-sm whitespace-pre-wrap break-words px-4 py-4 align-top text-slate-600";
            cell.textContent = value;
            row.append(cell);
        }

        const statusCell = document.createElement("td");
        statusCell.className = "px-4 py-4 align-top";
        const statusSelect = document.createElement("select");
        statusSelect.className = "status-chip";
        statusSelect.setAttribute("aria-label", `Status for request from ${request.name}`);
        statusSelect.dataset.statusRequestId = String(request.id);
        for (const status of quoteStatuses) {
            const option = document.createElement("option");
            option.value = status;
            option.textContent = status[0].toUpperCase() + status.slice(1);
            statusSelect.append(option);
        }
        statusSelect.value = quoteStatuses.includes(request.status) ? request.status : "new";
        statusSelect.dataset.previousStatus = statusSelect.value;
        setStatusChip(statusSelect, statusSelect.value);
        statusCell.append(statusSelect);
        row.append(statusCell);

        const actionCell = document.createElement("td");
        actionCell.className = "px-4 py-4 align-top";
        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-request-button";
        deleteButton.type = "button";
        deleteButton.setAttribute("aria-label", `Delete quote request from ${request.name}`);
        deleteButton.title = "Delete request";
        deleteButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-.9 14H5.9L5 6m4 4v6m6-6v6"/></svg>`;
        deleteButton.dataset.deleteRequestId = String(request.id);
        actionCell.append(deleteButton);
        row.append(actionCell);
        requestsBody.append(row);
    }
}

requestsBody.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-status-request-id]");
    if (!select) return;
    const previousStatus = select.dataset.previousStatus || "new";
    const requestId = select.dataset.statusRequestId;
    select.dataset.previousStatus = select.value;
    setStatusChip(select, select.value);
    select.disabled = true;
    requestsError.classList.add("hidden");

    try {
        const response = await fetch(`/api/requests?id=${encodeURIComponent(requestId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ status: select.value }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(getErrorMessage(result.error, "Could not update status."));
        select.dataset.previousStatus = result.status;
    } catch (error) {
        select.value = previousStatus;
        select.dataset.previousStatus = previousStatus;
        setStatusChip(select, previousStatus);
        requestsError.textContent = getErrorMessage(error, "Could not update status.");
        requestsError.classList.remove("hidden");
    } finally {
        select.disabled = false;
    }
});

requestsBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-request-id]");
    if (!button) return;
    const confirmation = await Swal.fire({
        title: "Delete quote request?",
        text: "This action cannot be undone.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yes, delete it",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#b42318",
        cancelButtonColor: "#667085",
        focusCancel: true,
    });
    if (!confirmation.isConfirmed) return;

    button.disabled = true;
    requestsError.classList.add("hidden");
    try {
        const response = await fetch(
            `/api/requests?id=${encodeURIComponent(button.dataset.deleteRequestId)}`,
            { method: "DELETE", headers: { Accept: "application/json" } },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(getErrorMessage(result.error, "Could not delete request."));
        await getRequests();
    } catch (error) {
        button.disabled = false;
        requestsError.textContent = getErrorMessage(error, "Could not delete request.");
        requestsError.classList.remove("hidden");
    }
});

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
        if (!response.ok) throw new Error(getErrorMessage(result.error, "Sign in failed."));
        loginForm.reset();
        await getRequests();
    } catch (error) {
        loginError.textContent = getErrorMessage(error, "Sign in failed. Please try again.");
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
