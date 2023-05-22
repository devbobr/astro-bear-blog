import { readFileSync, statSync } from "fs";
import { join } from "path";

export interface BearImportItem {
	basePath: string;
	fileName: string;
	assetDir?: string;
}

export default class BearContentHandler {
	private readonly _importItem: BearImportItem;
	private _astroBlogPath: string;
	private _slugifiedFileName: string;
	private _fileContent: string | undefined;
	private _frontmatterAttributes: Record<string, any> = {};
	private _tagList: Set<string> = new Set();

	constructor(importItem: BearImportItem, astroBlogPath: string = "/blog") {
		this._importItem = importItem;
		this._astroBlogPath = astroBlogPath; // Path to the Astro site blog folder

		// Prepare the target file names
		this._slugifiedFileName = BearContentHandler.slugify(
			this._importItem.fileName,
			true
		);

		this._readFile() // Read the Markdown file content
			._extractFMTitle() // Extract the title from the first line of the content
			._extractFMAttributes() // Extract the frontmatter attributes from the content
			._addFMFileMetadata() // Add the file metadata to the frontmatter attributes
			._repairUnslugifiedLinks() // Repair all the unslugified links within the content
			._replaceWikiLinks() // Replace the wiki links with markdown links
			._extractTags() // Extract the tags from the content
			._replaceUnderlining(); // Replace the Bear underlining markdown '~' with <u> tags
	}

	private _readFile() {
		const filePath = [
			this._importItem.basePath,
			this._importItem.fileName,
		].join("/");
		const content = readFileSync(filePath, "utf-8");

		this._fileContent = content.trim();

		return this;
	}

	private _addFMFileMetadata() {
		if (!this._importItem.fileName) {
			throw new Error("No file name to add frontmatter to");
		}

		const filePath = [
			this._importItem.basePath,
			this._importItem.fileName,
		].join("/");
		const fileInfo = statSync(filePath);

		const createDate = fileInfo.birthtime;
		const updateDate = fileInfo.mtime;

		this.addAttribute("createDate", createDate.toISOString());
		this.addAttribute("updateDate", updateDate.toISOString());

		return this;
	}

	private _extractFMTitle() {
		if (!this._fileContent) {
			throw new Error("No file content to extract frontmatter from");
		}

		// Extract the first line of the content as the title and remove it from the content
		const parts = this._fileContent.split("\n");
		const title = `'${(parts.shift() || "").replace("# ", "")}'`; // Remove the first line and the leading "# "

		this.addAttribute("title", title);
		this._fileContent = parts.join("\n").trim();

		return this;
	}

	private _replaceUnderlining() {
		if (!this._fileContent) {
			throw new Error("No file content to replace underlining in");
		}

		// Find content with ~content~ and replace it with <u>content</u>
		const regex = /~([^~]+)~/g;
		this._fileContent = this._fileContent.replace(regex, "<u>$1</u>");

		return this;
	}

	private _extractFMAttributes() {
		if (!this._fileContent) {
			throw new Error("No file content to extract frontmatter from");
		}

		// Check if the content starts with a frontmatter
		if (!this._fileContent.startsWith("---")) {
			return this;
		}

		let attributes = "";
		this._fileContent = this._fileContent
			.replace(/---\n.*?\n---/s, (match, token) => {
				attributes = match;
				return ""; // Remove the frontmatter from the content, we will add it to the frontmatter array later
			})
			.trim();

		// Check if we have a frontmatter
		if (!attributes) {
			return this;
		}

		// Parse the attributes
		const lines = attributes.split("\n");
		lines.forEach((line) => {
			// Attention, values can contain colons, so we have to split only at the first colon
			const parts = line.split(":");
			const key = parts.shift()?.trim();

			let value = parts.join(":").trim();

			value = decodeURIComponent(value);
			// Skip empty lines
			if (!key || !value) return;

			// We have to quote existing quotes in the value
			value = value.replace(/"/g, '\\"');

			// We have to remove typographical quotes coming from Bear
			value = value.replace(/„|“/g, '"');

			// Remove potential image links and keep the link target
			value = value.replace(/\!\[.*\]\((.*)\)/g, (_match, tag) =>
				join(this._astroBlogPath, BearContentHandler.slugify(tag, true))
			);

			// Add the frontmatter to the frontmatter array
			if (key.length && value.length) {
				this.addAttribute(key.trim(), value.trim());
			}
		});

		return this;
	}

	private _extractTags() {
		if (!this._fileContent) {
			throw new Error("No file content to extract tags from");
		}

		// Extract the tags from the content
		const tagItems = this._fileContent.match(/(?<=#)[\w-\/]+/g) || [];

		// No tags found, we're done here
		if (!tagItems.length) return this;

		// Remove tag text from content
		tagItems.forEach((tag) => {
			this._fileContent = this._fileContent!.replace(`#${tag}`, "");
		});

		// Add tags to tag array
		tagItems.forEach((tag) => {
			this.addTag(tag);
		});

		return this;
	}

	private _repairUnslugifiedLinks() {
		if (!this._fileContent) {
			throw new Error("No file content to repair links in");
		}

		const regexPattern =
			/!?\[[^\]]*\]\((.*?)\s*("(?:.*[^"])")?\s*\)(?:<!--([^>]*)-->)?/gm;

		this._fileContent = this._fileContent.replace(
			regexPattern,
			(match: string, link, _empty, comment) => {
				const slugifiedLink = BearContentHandler.slugify(
					decodeURIComponent(link),
					true
				);

				// Convert the Bear comments to an object and then to a string
				let attribs = "";
				if (comment) {
					const obj = JSON.parse(comment);

					// convert the object to an array of key-value pairs
					const result = Object.entries(obj)
						// filter out empty values
						.filter(([, v]) => v)
						// convert each entry to a string in the form of "key=value"
						.map(([k, v]) => `${k}=${v}`)
						// join the array to a single string
						.join(" ");

					attribs = ` ${result}`;
				}

				// Create the new link
				const newLink = [
					this._astroBlogPath,
					slugifiedLink + (comment ? `?${attribs.trim()}` : ""),
				].join("/");

				return match.replace(link, newLink);
			}
		);

		return this;
	}

	private _replaceWikiLinks() {
		if (!this._fileContent) {
			throw new Error("No file content to replace wiki links in");
		}

		const regex = /\[\[([^\]]+)\]\]/g;
		const text = this._fileContent;
		const markdown = text.replace(regex, (_match, path: string) => {
			const slugifiedPath = BearContentHandler.slugify(path);
			const finalPath = [this._astroBlogPath, slugifiedPath].join("/");

			return `[${path}](${finalPath})`;
		});

		this._fileContent = markdown;

		return this;
	}

	private _tagsToString() {
		const uniqueTags = [...this._tagList];

		// Bear has hierarchical tags, we have to flatten them,
		// add them to the tag list
		uniqueTags.forEach((tag) => {
			// For slash separated tags we have to add the array of splitted tags
			if (tag.includes("/")) {
				tag.split("/").forEach((tagItem) => {
					this._tagList.add(tagItem);
				});
			}
		});

		const newUniqueTags = [...this._tagList];

		return newUniqueTags.map((tag) => `'${tag.toLowerCase()}'`).join(", ");
	}

	private _buildFrontmatter() {
		// We have to add the filename to the frontmatter for later use in the template
		this.addAttribute("filename", this._slugifiedFileName);

		const attributes = Object.entries(this._frontmatterAttributes)
			.map(([key, value]) => {
				return `${key}: ${value}`;
			})
			.join("\n");

		const tags = this._tagsToString();

		return `---\n${attributes}\ntags: [${tags}]\n---`;
	}

	private _removeComments(content: string) {
		// Remove potential html comments coming from Bear image resize
		const lines = content.split("\n");

		lines.forEach((line, index) => {
			if (line.includes("<!--")) {
				// Remove the comment
				lines[index] = line.replace(/<!--(.*)-->/g, "");
			}
		});

		return lines.join("\n");
	}

	public getBearId() {
		const id: string | null = this._frontmatterAttributes["bearId"];
		return id;
	}

	public get filename() {
		return this._importItem.fileName;
	}

	public get unpublish() {
		const bVal = this._frontmatterAttributes["unpublish"];
		const unpubVal = bVal && bVal.toLowerCase() === "true";

		return unpubVal;
	}

	public addTag(tag: string) {
		this._tagList.add(tag);
	}

	public addAttribute(key: string, value: any) {
		// The Bear app / Mac OS likes to capitalize the first letter of the frontmatter attributes
		// We have to lowercase it again
		const theKey = key.charAt(0).toLowerCase() + key.slice(1);

		this._frontmatterAttributes[theKey.trim()] = value;
	}

	public getFinalDocument() {
		const frontmatter = this._buildFrontmatter();
		const rawContent = [frontmatter, this._fileContent].join("\n\n");
		const content = this._removeComments(rawContent);

		return {
			originalFileName: this._importItem.fileName,
			slugifiedFileName: this._slugifiedFileName,
			content,
		};
	}

	/**
	 * Slugifies a string by replacing spaces with dashes and removing all non-word characters.
	 * @param str String to slugify
	 * @param isFile Indicates if the string is a file name. Removes the file extension if true.
	 * @returns The slugified string
	 */
	public static slugify(str: string | undefined, isFile = false) {
		if (!str) return "";

		str = decodeURI(str).normalize();

		// If str contains slashes, we have to slugify each part
		if (str.includes("/")) {
			const parts = str.split("/");
			const lastItem = parts.at(-1);

			const slugifiedParts = parts.map((part): string => {
				return this.slugify(part, isFile && lastItem === part) || "";
			});

			return slugifiedParts.join("/");
		}

		let name = str;
		let ext = "";

		if (isFile) {
			const fragments = str.split(".");
			ext = fragments.pop() || "";
			name = fragments.join(".");
		}

		name = name
			.toLowerCase()
			.replace(/ /g, "-")
			.replace(/[^\w-]+/g, "");

		if (!ext) return name;

		// Here we convert the file extension to mdx
		return `${name}.${ext === "md" ? "mdx" : ext}`;
	}
}
