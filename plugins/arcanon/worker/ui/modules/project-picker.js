/**
 * Project picker — shows when no project is specified in the URL.
 * Auto-selects if only one project has data.
 */

export async function showProjectPicker() {
  const picker = document.getElementById("project-picker");
  const list = document.getElementById("project-list");

  let projects;
  try {
    const resp = await fetch("/projects");
    if (!resp.ok) throw new Error("Failed to fetch projects");
    projects = await resp.json();
  } catch {
    document.getElementById("node-info").textContent = "Cannot reach server.";
    return null;
  }

  if (projects.length === 0) {
    picker.style.display = "block";
    list.innerHTML =
      '<p class="no-projects">No projects found. Run <code>/ligamen:map</code> to scan your repos first.</p>';
    document.getElementById("node-info").textContent = "No projects";
    return null;
  }

  projects.sort((a, b) => b.size - a.size);
  const withData = projects.filter((p) => p.serviceCount > 0);

  // Auto-select single project via hash
  if (withData.length === 1) {
    picker.style.display = "none";
    const newUrl = new URL(window.location);
    newUrl.searchParams.set("hash", withData[0].hash);
    window.history.replaceState({}, "", newUrl);
    return "__hash__" + withData[0].hash;
  }

  const enriched = withData.length > 0 ? withData : projects;

  picker.style.display = "block";
  list.innerHTML = "";
  document.getElementById("node-info").textContent = "Select a project to view";

  return new Promise((resolve) => {
    for (const p of enriched) {
      const btn = document.createElement("button");
      btn.className = "project-item";

      const sizeKB = Math.round(p.size / 1024);
      const displayName = p.projectRoot
        ? p.projectRoot.split("/").pop()
        : p.hash;
      const displayPath = p.projectRoot || p.dbPath;
      btn.innerHTML = `
        <div><strong>${displayName}</strong></div>
        <div class="project-path">${displayPath}</div>
        <div class="project-stats">${p.serviceCount} services, ${p.repoCount} repos — ${sizeKB} KB</div>
      `;

      btn.addEventListener("click", () => {
        picker.style.display = "none";
        resolve("__hash__" + p.hash);
      });

      list.appendChild(btn);
    }
  });
}
