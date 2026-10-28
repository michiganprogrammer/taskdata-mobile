const STORAGE_KEY = 'taskdata-mobile-v3';
const emptyData = { folders: [], tasks: [] };
let data = load();
let folderId = null;
let stack = [];
let dialog = null;
let treeScopes = new Set();
const app = document.querySelector('#app');

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Older Version 2 builds saved an empty prototype. Replace only that
      // empty state with the packaged data; never overwrite real user work.
      if (parsed?.folders?.length) return enrichData(parsed);
    }
  } catch { /* fall through to packaged defaults */ }
  return defaultData();
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function defaultData() {
  const oldData = window.TASKDATA_DEFAULT;
  if (!oldData?.folders || !oldData?.tasks) return structuredClone(emptyData);
  const oldById = new Map(oldData.tasks.map((task) => [task.id, task]));
  const rootFolderId = (task) => {
    let current = task;
    while (current && current.parentId != null) current = oldById.get(current.parentId);
    return current?.folderId ?? task.folderId;
  };
  return {
    folders: oldData.folders.map((folder) => ({ id: String(folder.id), name: folder.name })),
    tasks: oldData.tasks.map((task) => ({
      id: String(task.id), folderId: String(rootFolderId(task)), parentId: task.parentId == null ? null : String(task.parentId),
      title: task.title, assignedTo: task.assignedTo || '', dueDate: task.dueDate || '', dateCreated: task.dateCreated || '',
      state: task.blocker && task.status === 'open' ? 'blocked' : task.status,
      notes: task.entries.map((entry) => ({ id: String(entry.id), date: entry.date, text: entry.text })),
    })),
  };
}
function enrichData(saved) {
  const defaults = defaultData();
  const defaultsById = new Map(defaults.tasks.map((task) => [task.id, task]));
  return {
    ...saved,
    tasks: saved.tasks.map((task) => ({
      ...task,
      assignedTo: task.assignedTo || '',
      dueDate: task.dueDate || '',
      dateCreated: task.dateCreated || defaultsById.get(task.id)?.dateCreated || '',
    })),
  };
}
function esc(value) { return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[c]); }
function id() { return crypto.randomUUID(); }
function byId(taskId) { return data.tasks.find((task) => task.id === taskId); }
function children(parentId) { return data.tasks.filter((task) => task.parentId === parentId); }
function folderById(id) { return data.folders.find((folder) => folder.id === id); }
function fmt(iso) { return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }); }
function today() { return new Date().toISOString().slice(0, 10); }

function renderTop(title, back, menu) {
  return `<div class="status"><span>9:41</span><span>5G ▮▮▮ 100%</span></div><header class="nav">${back ? '<button class="back" data-back aria-label="Back">‹</button>' : ''}<span class="nav-title">${esc(title)}</span>${menu ? '<button class="menu" data-menu aria-label="Options"><i></i><i></i><i></i></button>' : ''}</header>`;
}
function taskState(task) { return task.state === 'closed' ? 'Done' : task.state === 'blocked' ? 'Blocked' : task.state === 'cancelled' ? 'Cancelled' : 'In progress'; }
function descendantTasks(task) {
  const result = [];
  for (const child of children(task.id)) result.push(child, ...descendantTasks(child));
  return result;
}
function taskProgress(task) {
  const all = descendantTasks(task);
  if (!all.length) return task.state === 'closed' ? 100 : 0;
  return Math.round((all.filter((child) => child.state === 'closed').length / all.length) * 100);
}
function taskCard(task) {
  const cls = task.state === 'closed' ? ' done' : task.state === 'blocked' ? ' blocked' : task.state === 'cancelled' ? ' cancelled' : '';
  const detail = task.state === 'closed' ? 'Closed' : task.state === 'blocked' ? 'Blocked' : task.state === 'cancelled' ? 'Cancelled' : children(task.id).length ? `${children(task.id).length} subtask${children(task.id).length === 1 ? '' : 's'}` : task.dueDate ? `Due ${fmt(task.dueDate)}` : task.assignedTo ? `Assigned to ${task.assignedTo}` : 'Open';
  return `<button class="task-card${cls}" data-open-task="${task.id}"><span><b>${esc(task.title)}</b><small>${detail}</small></span></button>`;
}
function treeRows(parentId, depth = 0) {
  const tasks = parentId == null
    ? data.tasks.filter((task) => task.parentId === null && task.folderId === folderId)
    : children(parentId);
  return tasks.map((task) => {
    const cls = task.state === 'closed' ? ' done' : task.state === 'blocked' ? ' blocked' : task.state === 'cancelled' ? ' cancelled' : '';
    const childRows = children(task.id).length ? `<div class="tree-children">${treeRows(task.id, depth + 1)}</div>` : '';
    return `<div class="tree-item"><button class="tree-row${cls}" data-open-task="${task.id}"><span><b>${esc(task.title)}</b><small>${taskState(task)}${children(task.id).length ? ` · ${children(task.id).length} subtask${children(task.id).length === 1 ? '' : 's'}` : ''}</small></span></button>${childRows}</div>`;
  }).join('');
}
function scopeId(parent) { return parent ? `task:${parent.id}` : `folder:${folderId}`; }
function isTreeView(parent) { return treeScopes.has(scopeId(parent)); }
function foldersPage() {
  return `${renderTop('Folders', false, true)}<section class="content"><section class="block folder-block"><div class="label">TaskData</div><h1>Your folders</h1></section><section class="block"><div class="label">Folders</div><div class="list">${data.folders.length ? data.folders.map((folder) => `<button class="task-card" data-open-folder="${folder.id}"><b>${esc(folder.name)}</b><small>${data.tasks.filter((task) => task.folderId === folder.id && task.parentId === null).length} main tasks</small></button>`).join('') : '<p class="empty">No folders yet. Create one to start organizing your work.</p>'}</div><button class="create-folder-card" data-new-folder><span>+</span>Create folder</button></section></section>`;
}
function taskListPage(parent) {
  const list = parent ? children(parent.id) : data.tasks.filter((task) => task.folderId === folderId && task.parentId === null);
  const heading = parent ? parent.title : folderById(folderId)?.name || 'Folder';
  const treeView = isTreeView(parent);
  if (!parent) return `${renderTop('Folder', true, true)}<section class="content"><div class="crumb">Folder / ${esc(heading)}</div><section class="folder-hero"><span class="soft-tag">Folder</span><h1>${esc(heading)}</h1><p>${treeView ? 'Expanded task hierarchy' : `${list.length} active work records`}</p></section><section class="task-section"><div class="section-row"><h2>${treeView ? 'Task tree' : 'Tasks'}</h2><button class="outline-add" data-new-task="">＋ Add task</button></div><div class="${treeView ? 'tree-list' : 'list hierarchy-list'}">${list.length ? (treeView ? treeRows(null) : list.map(taskCard).join('')) : '<p class="empty">No tasks yet. Add one to begin.</p>'}</div></section></section>`;
  const progress = taskProgress(parent);
  return `${renderTop('Task detail', true, true)}<section class="content"><div class="crumb">${esc(folderById(folderId)?.name || 'Folder')} / ${esc(parent.title)}</div><section class="task-hero"><span class="soft-tag">Task</span><h1>${esc(parent.title)}</h1><div class="progress-line"><span style="width:${progress}%"></span></div><div class="task-facts"><span class="status-pill ${parent.state}">${taskState(parent)}</span>${parent.dueDate ? `<span>Due ${fmt(parent.dueDate)}</span>` : ''}${parent.assignedTo ? `<span>${esc(parent.assignedTo)}</span>` : ''}</div></section><section class="task-section"><div class="section-row"><h2>${treeView ? 'Task tree' : `Tasks (${list.length})`}</h2><button class="outline-add" data-new-task="${parent.id}">＋ Add subtask</button></div><div class="${treeView ? 'tree-list' : 'list hierarchy-list nested'}">${list.length ? (treeView ? treeRows(parent.id) : list.map(taskCard).join('')) : '<p class="empty">No subtasks yet. Add one to continue the work.</p>'}</div></section></section><button class="fab" data-new-task="${parent.id}" aria-label="Create subtask">＋</button>`;
}
function leafPage(task) {
  const details = `${task.assignedTo ? `<section class="task-info-block"><div class="label">Assigned to</div><strong>${esc(task.assignedTo)}</strong></section>` : ''}${task.dateCreated ? `<section class="task-info-block"><div class="label">Date created</div><strong>${fmt(task.dateCreated)}</strong></section>` : ''}`;
  return `${renderTop('Task detail', true, true)}<section class="content"><section class="block task-block"><div class="label">Task</div><h1>${esc(task.title)}</h1></section>${details ? `<div class="task-info-grid">${details}</div>` : ''}<section class="notes-section"><div class="notes-heading"><h2>Task notes</h2>${task.notes.length ? `<span>${task.notes.length} ${task.notes.length === 1 ? 'note' : 'notes'}</span>` : ''}</div>${task.notes.length ? `<div class="notes-feed">${task.notes.map((note) => `<article class="note-card"><div class="date">${fmt(note.date)}</div><p>${esc(note.text)}</p></article>`).join('')}</div>` : '<p class="empty">No task notes yet.</p>'}</section></section><section class="composer"><div class="label">New note</div><textarea id="noteText" placeholder="Write your progress, finding, or decision..."></textarea><div class="composer-foot"><span>Today · ${fmt(today())}</span><button class="add" data-add-note="${task.id}">Add note</button></div></section>`;
}
function currentTask() { return stack.at(-1) || null; }
function render() {
  document.querySelectorAll('.sheet,.sheet-backdrop,.drawer').forEach((el) => el.remove());
  const task = currentTask();
  app.innerHTML = !folderId ? foldersPage() : task && children(task.id).length === 0 ? leafPage(task) : taskListPage(task);
  if (dialog) renderDialog();
}
function refreshTaskListContent() {
  const task = currentTask();
  const preview = document.createElement('div');
  preview.innerHTML = taskListPage(task);
  const replacement = preview.querySelector('.content');
  const current = app.querySelector('.content');
  if (current && replacement) current.replaceWith(replacement);
}
function renderDialog() {
  document.querySelectorAll('.sheet,.sheet-backdrop,.drawer').forEach((el) => el.remove());
  const title = dialog.type === 'folder' ? 'New folder' : dialog.type === 'task' ? 'New task' : dialog.type === 'edit-task' ? 'Edit task' : 'Options';
  let body = '';
  if (dialog.type === 'folder') body = `<label>Name<input id="dialogName" autofocus placeholder="Folder name"></label><button class="primary" data-save-dialog>Create</button>`;
  if (dialog.type === 'task') body = `<label>Task name<input id="dialogName" autofocus placeholder="Task name"></label><label>Assigned to <span class="optional">optional</span><input id="dialogAssignedTo" placeholder="Name"></label><label>Due date <span class="optional">optional</span><input id="dialogDueDate" type="date"></label><button class="primary" data-save-dialog>Create</button>`;
  if (dialog.type === 'edit-task') body = `<p class="dialog-help">Update the task when its wording, owner, date, or state changes.</p><label>Task name<input id="dialogName" autofocus value="${esc(dialog.task.title)}"></label><label>Assigned to <span class="optional">optional</span><input id="dialogAssignedTo" value="${esc(dialog.task.assignedTo || '')}" placeholder="Name"></label><label>Due date <span class="optional">optional</span><input id="dialogDueDate" type="date" value="${esc(dialog.task.dueDate || '')}"></label><label>Task state<select id="dialogState"><option value="open">Open</option><option value="blocked">Blocked / waiting</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></label><button class="primary" data-save-dialog>Save task</button><button class="danger" data-delete-task="${dialog.task.id}">Delete task</button>`;
  if (dialog.type === 'options') {
    const task = currentTask();
    const treeView = isTreeView(task);
    const canShowTree = folderId && (!task || children(task.id).length > 0);
    const viewToggle = canShowTree ? `<button class="tree-toggle" data-toggle-tree aria-pressed="${treeView}"><span>Tree view</span><span class="toggle-track"><i></i></span></button>` : '';
    const actions = folderId
      ? `${viewToggle}${task ? '<button data-edit-current>Edit task</button><button data-new-task="' + task.id + '">Add subtask</button><button class="danger" data-delete-task="' + task.id + '">Delete task</button>' : '<button data-new-task="">Add task</button>'}<button data-open-folders>All folders</button>${!task ? '<button class="danger" data-delete-folder>Delete folder</button>' : ''}`
      : `<button data-new-folder>Create folder</button>`;
    document.body.insertAdjacentHTML('beforeend', `<div class="sheet-backdrop drawer-backdrop" data-close-dialog></div><aside class="drawer" aria-label="Options"><div class="drawer-head"><span>TaskData</span><button data-close-dialog aria-label="Close menu">×</button></div><h2>${folderId ? (task ? esc(task.title) : esc(folderById(folderId)?.name || 'Folder')) : 'Menu'}</h2>${actions}</aside>`);
    return;
  }
  const dialogClass = dialog.type === 'folder' || dialog.type === 'task' || dialog.type === 'edit-task' ? 'sheet centered-sheet' : 'sheet';
  document.body.insertAdjacentHTML('beforeend', `<div class="sheet-backdrop" data-close-dialog></div><section class="${dialogClass}"><h2>${title}</h2>${body}<button data-close-dialog>Cancel</button></section>`);
  if (dialog.type === 'edit-task') document.querySelector('#dialogState').value = dialog.task.state;
}
function openTask(task) { stack.push(task); render(); }
function createFolder(name) { data.folders.push({ id:id(), name }); dialog = null; save(); render(); }
function createTask(title, parentId, assignedTo, dueDate) { data.tasks.push({ id:id(), folderId, parentId:parentId || null, title, assignedTo, dueDate, dateCreated:today(), state:'open', notes:[] }); dialog = null; save(); render(); }
function deleteTask(taskId) { const remove = new Set([taskId]); let changed = true; while (changed) { changed = false; for (const task of data.tasks) if (remove.has(task.parentId) && !remove.has(task.id)) { remove.add(task.id); changed = true; } } data.tasks = data.tasks.filter((task) => !remove.has(task.id)); stack = stack.filter((task) => !remove.has(task.id)); save(); dialog = null; render(); }
function deleteFolder() { data.tasks = data.tasks.filter((task) => task.folderId !== folderId); data.folders = data.folders.filter((folder) => folder.id !== folderId); folderId = null; stack = []; dialog = null; save(); render(); }

document.addEventListener('click', (event) => {
  const folder = event.target.closest('[data-open-folder]'); if (folder) { folderId = folder.dataset.openFolder; stack = []; render(); return; }
  const open = event.target.closest('[data-open-task]'); if (open) { openTask(byId(open.dataset.openTask)); return; }
  if (event.target.closest('[data-back]')) { if (stack.length) stack.pop(); else folderId = null; render(); return; }
  if (event.target.closest('[data-menu]')) { dialog = { type:'options' }; renderDialog(); return; }
  if (event.target.closest('[data-close-dialog]')) { dialog = null; document.querySelectorAll('.sheet,.sheet-backdrop,.drawer').forEach((el) => el.remove()); return; }
  if (event.target.closest('[data-new-folder]')) { dialog = { type:'folder' }; renderDialog(); return; }
  const newTask = event.target.closest('[data-new-task]'); if (newTask) { dialog = { type:'task', parentId:newTask.dataset.newTask || null }; renderDialog(); return; }
  if (event.target.closest('[data-save-dialog]')) { const name = document.querySelector('#dialogName').value.trim(); if (!name) return; const assignedTo = document.querySelector('#dialogAssignedTo')?.value.trim() || ''; const dueDate = document.querySelector('#dialogDueDate')?.value || ''; if (dialog.type === 'folder') createFolder(name); if (dialog.type === 'task') createTask(name, dialog.parentId, assignedTo, dueDate); if (dialog.type === 'edit-task') { dialog.task.title = name; dialog.task.assignedTo = assignedTo; dialog.task.dueDate = dueDate; dialog.task.state = document.querySelector('#dialogState').value; dialog = null; save(); render(); } return; }
  if (event.target.closest('[data-edit-current]')) { const task = currentTask(); if (!task) return; dialog = { type:'edit-task', task }; renderDialog(); return; }
  const deleteTaskButton = event.target.closest('[data-delete-task]'); if (deleteTaskButton && confirm('Delete this task and all of its subtasks?')) { deleteTask(deleteTaskButton.dataset.deleteTask); return; }
  if (event.target.closest('[data-delete-folder]') && confirm('Delete this folder and all of its tasks?')) { deleteFolder(); return; }
  if (event.target.closest('[data-toggle-tree]')) {
    const key = scopeId(currentTask());
    if (treeScopes.has(key)) treeScopes.delete(key); else treeScopes.add(key);
    refreshTaskListContent();
    const toggle = document.querySelector('[data-toggle-tree]');
    if (toggle) toggle.setAttribute('aria-pressed', String(treeScopes.has(key)));
    return;
  }
  if (event.target.closest('[data-open-folders]')) { folderId = null; stack = []; dialog = null; render(); return; }
  const addNote = event.target.closest('[data-add-note]'); if (addNote) { const text = document.querySelector('#noteText').value.trim(); if (!text) return; byId(addNote.dataset.addNote).notes.push({ id:id(), date:today(), text }); save(); render(); return; }
  const deleteNote = event.target.closest('[data-delete-note]'); if (deleteNote) { const [taskId, noteId] = deleteNote.dataset.deleteNote.split(':'); const task = byId(taskId); task.notes = task.notes.filter((note) => note.id !== noteId); save(); render(); }
});
render();
