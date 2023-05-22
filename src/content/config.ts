import { defineCollection, z } from "astro:content";

export const categories = [
	"Azure",
	"Backend",
	"General",
	"Hybrid Work",
	"Microsoft 365",
	"Technology",
	"Test",
	"Tools",
	"Typescript",
	"Web Development",
] as const;

const blog = defineCollection({
	// Type-check frontmatter using a schema
	schema: z.object({
		filename: z.string(),
		title: z.string(),
		page: z.string().optional(),
		category: z.enum(categories).optional(),
		description: z.string().optional(),
		// Transform string to Date object
		createDate: z
			.string()
			.or(z.date())
			.transform((val) => new Date(val)),
		updateDate: z
			.string()
			.or(z.date())
			.transform((str) => (str ? new Date(str) : new Date())),
		heroImage: z.string().optional(),
		featured: z.boolean().optional(),
		unpublish: z.boolean().optional(),
		tags: z.array(z.string()).optional(),
	}),
});

export const collections = { blog };
