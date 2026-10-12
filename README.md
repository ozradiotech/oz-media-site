# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

Color pallete:
1. #f2bd57 (Yellow)
2. #000000 (Black)
3. #FFFFF3 (White)

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## Decap CMS

The OZ Bandung editorial content is stored in `src/content/` and managed from `/admin`. To edit it locally, start the Astro dev server with `npm run dev` and the Decap local proxy in another terminal with `npm run cms:proxy`, then open `http://localhost:4321/admin`. The proxy writes to the local repository; commit the content and uploaded files to publish them through the site's normal deployment.

CMS-uploaded images go in `public/uploads` and are served from `/uploads`. The CMS is currently configured for local editing only. Before deploying the admin for hosted editing, choose a Decap Git backend, configure its repository, branch, and authentication, and remove `local_backend` from `public/admin/config.yml`. The current `git-gateway` backend entry is a local proxy placeholder, not a production login configuration.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
