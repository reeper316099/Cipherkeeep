export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  count: number;
}

/** Folder tree from note folder paths (`a/b`), with recursive note counts. */
export function buildFolderTree(folders: string[]): FolderNode {
  const root: FolderNode = { name: '', path: '', children: [], count: 0 };
  for (const f of folders) {
    let node = root;
    node.count++;
    let path = '';
    for (const part of f.split('/').filter(Boolean)) {
      path = path ? `${path}/${part}` : part;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, children: [], count: 0 };
        node.children.push(child);
      }
      child.count++;
      node = child;
    }
  }
  const sort = (n: FolderNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

export const inFolder = (noteFolder: string, selected: string) =>
  !selected || noteFolder === selected || noteFolder.startsWith(selected + '/');
