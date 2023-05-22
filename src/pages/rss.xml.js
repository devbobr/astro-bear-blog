import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { SITE_TITLE, SITE_DESCRIPTION } from "../consts";

export async function get(context) {
	const posts = await getCollection("blog");
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: posts
			.filter((post) => !post.data.page) // Remove pages
			.map((post) => ({
				title: post.data.title,
				pubDate: post.data.createDate,
				link: `/blog/${post.slug}/`,
			})),
		customData: `<language>de-de</language>`,
		stylesheet: "/rss/styles.xsl",
	});
}
