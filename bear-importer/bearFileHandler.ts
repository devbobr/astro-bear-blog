import config from "./config.json";
import {
	type FileChangeInfo,
	watch,
	lstat,
	writeFile,
	readdir,
	readFile,
	rm,
	mkdir,
	copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import BearContentHandler, { BearImportItem } from "./bearContentHandler";

const ac = new AbortController();
const { signal } = ac;

export default class BearFileHandler {
	private _runningImportTimeoutIdentifier: NodeJS.Timeout | null;
	private _newFileQueue: Map<string, boolean>;

	constructor() {
		this._runningImportTimeoutIdentifier = null;
		this._newFileQueue = new Map();

		this._init();
	}

	private async _init() {
		// Check if target folder exists
		if (!existsSync(config.TARGET_ASSET_PATH)) {
			await mkdir(config.TARGET_ASSET_PATH);
		}

		// Cleanup the export folder
		await rm(config.BEAR_EXPORT_PATH, { recursive: true });
		await mkdir(config.BEAR_EXPORT_PATH);
	}

	private async _handleCreatedFile(event: FileChangeInfo<string>) {
		const fullPath = join(config.BEAR_EXPORT_PATH, event.filename);
		const stat = await lstat(fullPath);

		if (stat.isFile()) {
			this._newFileQueue.set(event.filename, stat.isDirectory());
		}
	}

	private async _removeExistingBlogPost(bearId: string) {
		const blogPostPath = config.TARGET_FILE_PATH;
		const blogAssetPath = config.TARGET_ASSET_PATH;

		const postsMd = await readdir(blogPostPath, { withFileTypes: true });

		// Iterate over all the files in the blog post folder
		for await (const postMd of postsMd) {
			// We only want to process files
			if (!postMd.isFile()) continue;

			// read the file content
			const postContent = await readFile(
				join(blogPostPath, postMd.name),
				"utf-8"
			);

			// Check if the file contains the bearId
			if (postContent.includes(bearId)) {
				const filePath = join(blogPostPath, postMd.name);
				const folderPath = join(blogAssetPath, postMd.name)
					.split(".")
					.slice(0, -1)
					.join(".");

				console.log(
					":: older blog post found, deleting ",
					filePath,
					folderPath
				);

				// Delete the file and folder
				await rm(join(blogPostPath, postMd.name));
				try {
					await rm(folderPath, { recursive: true });
				} catch {}

				// end the loop, because we should only have one file with the bearId
				break;
			}
		}
	}

	private async _executeImport() {
		// Check if there are any files to import
		if (this._newFileQueue.size === 0) return;

		// Let's copy the eventStack and clear it so we can continue watching for changes
		const workingFileQueue = [...this._newFileQueue];
		this._newFileQueue.clear();

		console.log(":: starting import process...\n\n");

		const handlers: BearContentHandler[] = [];

		for await (const [filename] of workingFileQueue) {
			const item: BearImportItem = {
				basePath: config.BEAR_EXPORT_PATH,
				fileName: filename,
				assetDir: "",
			};

			console.log(`:: adding item "${item.fileName}" to import queue`);
			handlers.push(new BearContentHandler(item, config.ASTRO_BLOG_PATH));
		}

		for await (const handler of handlers) {
			// Check if a blog post with the same bearId already exists
			const bearId = handler.getBearId();
			bearId && (await this._removeExistingBlogPost(bearId));

			const fullFilePath = join(config.BEAR_EXPORT_PATH, handler.filename);
			const fname = handler.filename.split(".").slice(0, -1).join(".");
			const folderPath = join(config.BEAR_EXPORT_PATH, fname);

			const hasDir = existsSync(folderPath);

			// Write the file
			if (!handler.unpublish) {
				// Write only, if the file should not be unpublished
				const finalDoc = handler.getFinalDocument();
				await writeFile(
					join(config.TARGET_FILE_PATH, finalDoc.slugifiedFileName),
					finalDoc.content
				);
			}

			if (hasDir && !handler.unpublish) {
				// Create the directory in the target folder
				// but only if the content should not be unpublished
				const targetFolder = join(
					config.TARGET_ASSET_PATH,
					BearContentHandler.slugify(fname)
				);

				console.log(
					`:: processing copy from directory "${folderPath} to directory ${targetFolder}.`
				);
				try {
					await mkdir(targetFolder);
				} catch {}

				// Copy the directory to the target folder
				// Copy the files
				const dirEntries = await readdir(folderPath, { withFileTypes: true });

				for await (const dirEntry of dirEntries) {
					// We don't want to copy hidden files
					if (dirEntry.name.startsWith(".")) continue;

					// We don't want to copy sub directories
					if (!dirEntry.isFile()) continue;

					const repairedFilename = BearContentHandler.slugify(
						dirEntry.name,
						true
					);

					// Copy the file
					const from = join(folderPath, dirEntry.name);

					const to = join(targetFolder, repairedFilename);

					await copyFile(from, to);
				}

				console.log(`:: directory "${folderPath}" processed.`);
			}

			// Delete the file from the export folder
			console.log(
				`:: deleting export file and folder '${fullFilePath}, ${folderPath}'`
			);

			try {
				// It's possible that the folder does not exist
				await rm(folderPath, { recursive: true });
			} catch {}
			await rm(fullFilePath);
		}

		console.log("\n\n:: import process finished ::\n\n");
	}

	public async startWatching() {
		console.log(":: file watcher started ::");

		try {
			const watcher = watch(config.BEAR_EXPORT_PATH, {
				signal,
				recursive: false,
				persistent: true,
			});
			for await (const event of watcher) {
				const fullPath = join(config.BEAR_EXPORT_PATH, event.filename);

				if (event.filename.startsWith(".")) continue; // Ignore hidden files

				if (existsSync(fullPath)) {
					// Add the file to the queue
					this._handleCreatedFile(event);
				}

				if (this._runningImportTimeoutIdentifier) {
					clearTimeout(this._runningImportTimeoutIdentifier);
				}

				this._runningImportTimeoutIdentifier = setTimeout(() => {
					this._executeImport();
				}, 6000); // Wait 6 seconds with no changes before importing
			}
		} catch (err) {
			const { name } = err as Error;
			if (name === "AbortError") return;
			throw err;
		}
	}

	public stopWatching() {
		ac.abort();
		console.log(":: watcher stopped ::");
	}
}
