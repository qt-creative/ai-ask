import * as vscode from "vscode";
import * as path from "path";

/**
 * 递归生成 Markdown 格式的目录树
 * @param parentUri 父级目录的 Uri
 * @param items 当前目录下的文件/文件夹列表
 * @param prefix 缩进前缀
 * @returns Markdown 格式的目录树字符串
 */
async function generateMarkdownDirectoryTree(
  parentUri: vscode.Uri,
  items: [string, vscode.FileType][],
  prefix: string
): Promise<string> {
  const sortedItems = items.sort((a, b) => {
    if (
      a[1] === vscode.FileType.Directory &&
      b[1] !== vscode.FileType.Directory
    ) {
      return -1;
    }
    if (
      a[1] !== vscode.FileType.Directory &&
      b[1] === vscode.FileType.Directory
    ) {
      return 1;
    }
    return a[0].localeCompare(b[0]);
  });

  let md = "";
  const totalItems = sortedItems.length;

  for (let i = 0; i < totalItems; i++) {
    const [name, type] = sortedItems[i];
    const isLast = i === totalItems - 1;
    const itemUri = vscode.Uri.joinPath(parentUri, name);

    if (type === vscode.FileType.Directory) {
      md += `${prefix}${isLast ? "└── " : "├── "}📁 [${name}](./${name}/)\n`;
      const subItems = await vscode.workspace.fs.readDirectory(itemUri);
      const subPrefix = prefix + (isLast ? "    " : "│   ");
      const subTree = await generateMarkdownDirectoryTree(
        itemUri,
        subItems,
        subPrefix
      );
      md += subTree;
    } else {
      md += `${prefix}${isLast ? "└── " : "├── "}📄 ${name}\n`;
    }
  }

  return md;
}

/**
 * 递归获取所有文件（包括子目录中的文件），返回 [绝对路径, 相对路径, 扩展名]
 */
async function collectAllFiles(
  baseUri: vscode.Uri,
  currentUri: vscode.Uri,
  currentRelativePath: string
): Promise<[string, string, string][]> {
  const entries = await vscode.workspace.fs.readDirectory(currentUri);
  let allFiles: [string, string, string][] = [];

  for (const [name, type] of entries) {
    const absolutePath = path.join(currentUri.fsPath, name);
    const relativePath = path.posix.join(currentRelativePath, name);
    const itemUri = vscode.Uri.joinPath(currentUri, name);

    if (type === vscode.FileType.Directory) {
      const subFiles = await collectAllFiles(baseUri, itemUri, relativePath);
      allFiles = allFiles.concat(subFiles);
    } else {
      const ext = path.extname(name).toLowerCase().slice(1);
      allFiles.push([absolutePath, relativePath, ext]);
    }
  }

  return allFiles;
}

/**
 * 生成单个文件的 Markdown 代码块
 */
async function generateFileContentMarkdown(
  filePath: string,
  relativePath: string,
  extension: string
): Promise<string> {
  try {
    const fileUri = vscode.Uri.file(filePath);
    const contentBytes = await vscode.workspace.fs.readFile(fileUri);
    const content = contentBytes.toString();

    const language =
      extension === "ts"
        ? "typescript"
        : extension === "js"
        ? "javascript"
        : extension === "html"
        ? "html"
        : extension === "json"
        ? "json"
        : extension === "css"
        ? "css"
        : extension === "py"
        ? "python"
        : "text";

    return `\n### 📄 文件：${relativePath}\n\n\`\`\`${language}\n${content}\n\`\`\`\n`;
  } catch (error) {
    console.error(`❌ 读取文件失败 ${filePath}:`, error);
    return `\n### 📄 文件：${relativePath}（读取失败）\n\n（无法读取文件内容）\n\n`;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("🔥 ai-ask 插件已激活");

  const disposable = vscode.commands.registerCommand(
    "ai-ask.create",
    async (uri: vscode.Uri | undefined) => {
      if (!uri) {
        vscode.window.showErrorMessage("❌ 请对文件夹使用该命令！");
        return;
      }

      const folderPath = uri.fsPath;
      const aiMdPath = path.join(folderPath, "ai.md");

      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type !== vscode.FileType.Directory) {
          vscode.window.showErrorMessage(
            "❌ 请右键点击一个文件夹，而不是文件！"
          );
          return;
        }

        const items = await vscode.workspace.fs.readDirectory(uri);
        const config = vscode.workspace.getConfiguration("aiAsk");
        const includeExtensions = config.get<string[]>(
          "includeFileExtensions"
        ) || ["ts", "html", "json"];
        console.log("🔧 当前配置的包含文件后缀:", includeExtensions);

        // 1. 生成目录树（仅文件夹和允许的文件名展示，不包含文件内容）
        const dirStructure = await generateMarkdownDirectoryTree(
          uri,
          items,
          ""
        );

        // 2. 递归获取所有文件（包括子目录中的文件）
        const allFiles = await collectAllFiles(uri, uri, "");

        // 3. 过滤出允许的文件类型，且不是 ai.md
        let fileContentsMd = "";
        for (const [filePath, relativePath, ext] of allFiles) {
          if (ext === "md" && path.basename(filePath) === "ai.md") {
            continue;
          } // 排除 ai.md
          if (!includeExtensions.includes(ext)) {
            continue;
          }

          const contentMd = await generateFileContentMarkdown(
            filePath,
            relativePath,
            ext
          );
          fileContentsMd += contentMd;
        }

        const content = `以下是一个文件夹下的所有代码文件，请帮忙检查相关代码，指出错误，包括且不限于语法，注释，变量命名等

# 📁 目录结构：${path.basename(folderPath)}

${dirStructure}

${fileContentsMd}`;

        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(aiMdPath),
          Buffer.from(content, "utf8")
        );

        vscode.window.showInformationMessage(
          `✅ 已生成目录及所有子目录文件内容清单，保存至：${aiMdPath}`
        );
      } catch (error) {
        console.error("❌ ai-ask.create 命令执行出错：", error);
        vscode.window.showErrorMessage(
          `❌ 操作失败：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
