import { EFFORT_MINUTES, TaskItem } from "../../types";
import { FolderEntry, uid } from "../../lib/storage";

const readAsDataUrl = (file: File) =>
  new Promise<string | undefined>((resolve) => {
    const r = new FileReader();
    r.onload = () =>
      resolve(typeof r.result === "string" ? r.result : undefined);
    r.onerror = () => resolve(undefined);
    r.readAsDataURL(file);
  });

/**
 * Converts OS files / folders dropped via HTML5 DataTransfer into new tasks
 * for the given column.
 */
export async function buildTasksFromDroppedItems(
  entries: FileSystemEntry[],
  fileList: File[],
  targetColId: string
): Promise<TaskItem[]> {
  const created: TaskItem[] = [];

  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        const childEntries = await new Promise<FolderEntry[]>((resolve) => {
          reader.readEntries(
            (list) => {
              const mapped = list
                .filter(
                  (c) =>
                    c.name !== ".DS_Store" &&
                    c.name !== "Thumbs.db" &&
                    c.name !== "desktop.ini"
                )
                .map((c) => ({
                  name: c.name,
                  path: c.fullPath || c.name,
                  is_dir: c.isDirectory,
                }))
                .sort((a, b) =>
                  a.is_dir === b.is_dir
                    ? a.name.localeCompare(b.name)
                    : a.is_dir
                    ? -1
                    : 1
                );
              resolve(mapped);
            },
            () => resolve([])
          );
        });
        created.push({
          id: uid("task"),
          title: entry.name,
          notes: entry.fullPath || entry.name,
          columnId: targetColId,
          folderPath: entry.fullPath || entry.name,
          cachedFiles: childEntries,
          importance: 2,
          effort: "S",
          estimatedMinutes: EFFORT_MINUTES.S,
          actualMinutes: 0,
          status: "todo",
          createdAt: new Date().toISOString(),
        });
      } else {
        const fileEntry = entry as FileSystemFileEntry;
        const fileObj = await new Promise<File | null>((resolve) =>
          fileEntry.file(
            (f) => resolve(f),
            () => resolve(null)
          )
        );
        let imgPreview: string | undefined;
        if (fileObj && fileObj.type.startsWith("image/")) {
          imgPreview = await readAsDataUrl(fileObj);
        }
        created.push({
          id: uid("task"),
          title: entry.name,
          notes: entry.fullPath || entry.name,
          columnId: targetColId,
          filePath: entry.fullPath || entry.name,
          imagePreview: imgPreview,
          importance: 2,
          effort: "S",
          estimatedMinutes: EFFORT_MINUTES.S,
          actualMinutes: 0,
          status: "todo",
          createdAt: new Date().toISOString(),
        });
      }
    }
  } else if (fileList.length > 0) {
    for (const f of fileList) {
      let imgPreview: string | undefined;
      if (f.type.startsWith("image/")) {
        imgPreview = await readAsDataUrl(f);
      }
      created.push({
        id: uid("task"),
        title: f.name,
        columnId: targetColId,
        filePath: f.name,
        imagePreview: imgPreview,
        importance: 2,
        effort: "S",
        estimatedMinutes: EFFORT_MINUTES.S,
        actualMinutes: 0,
        status: "todo",
        createdAt: new Date().toISOString(),
      });
    }
  }

  return created;
}
