import { existsSync, statSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { JsonFileStore } from "./jsonFile.js";

export interface Workspace {
  id: string;
  name: string;
  folderPath: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

interface WorkspacesFile {
  version: number;
  workspaces: Workspace[];
}

const store = new JsonFileStore<WorkspacesFile>("workspaces.json", () => ({
  version: 1,
  workspaces: [],
}));

const sortForList = (a: Workspace, b: Workspace): number => {
  if (a.lastOpenedAt && b.lastOpenedAt) return b.lastOpenedAt - a.lastOpenedAt;
  if (a.lastOpenedAt) return -1;
  if (b.lastOpenedAt) return 1;
  return a.name.localeCompare(b.name);
};

export const listWorkspaces = (): Workspace[] => {
  return [...store.read().workspaces].sort(sortForList);
};

export const getWorkspace = (id: string): Workspace | null => {
  return store.read().workspaces.find((w) => w.id === id) ?? null;
};

export interface CreateWorkspaceInput {
  name: string;
  folderPath: string;
  color?: string | null;
}

export interface UpdateWorkspaceInput {
  name?: string;
  color?: string | null;
  folderPath?: string;
}

/**
 * Validates that the path exists, is a directory, and is read+write accessible
 * by the server process. Throws a string-message Error on failure.
 */
export const validateWorkspaceFolder = async (
  folderPath: string,
): Promise<void> => {
  if (!folderPath || !folderPath.trim()) {
    throw new Error("Folder path is required.");
  }
  if (!existsSync(folderPath)) {
    throw new Error(`Folder does not exist: ${folderPath}`);
  }
  const st = statSync(folderPath);
  if (!st.isDirectory()) {
    throw new Error(`Not a directory: ${folderPath}`);
  }
  try {
    await access(folderPath, constants.R_OK | constants.W_OK);
  } catch {
    throw new Error(`Folder is not readable/writable: ${folderPath}`);
  }
};

export const createWorkspace = (input: CreateWorkspaceInput): Workspace => {
  const now = Date.now();
  const id = uuid();
  const ws: Workspace = {
    id,
    name: input.name,
    folderPath: input.folderPath,
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
  };
  store.mutate((file) => ({ ...file, workspaces: [...file.workspaces, ws] }));
  return ws;
};

export const updateWorkspace = (
  id: string,
  input: UpdateWorkspaceInput,
): Workspace | null => {
  const existing = getWorkspace(id);
  if (!existing) return null;
  const next: Workspace = {
    ...existing,
    name: input.name ?? existing.name,
    color: input.color !== undefined ? input.color : existing.color,
    folderPath: input.folderPath ?? existing.folderPath,
    updatedAt: Date.now(),
  };
  store.mutate((file) => ({
    ...file,
    workspaces: file.workspaces.map((w) => (w.id === id ? next : w)),
  }));
  return next;
};

export const deleteWorkspace = (id: string): boolean => {
  let removed = false;
  store.mutate((file) => {
    const next = file.workspaces.filter((w) => w.id !== id);
    removed = next.length !== file.workspaces.length;
    return { ...file, workspaces: next };
  });
  return removed;
};

export const touchWorkspace = (id: string): void => {
  const now = Date.now();
  store.mutate((file) => ({
    ...file,
    workspaces: file.workspaces.map((w) =>
      w.id === id ? { ...w, lastOpenedAt: now } : w,
    ),
  }));
};
