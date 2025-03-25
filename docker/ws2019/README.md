ws2019
=====

Dockerfile for Windows Server 2019.

*The official base image has the goofy peculiarity of not coming with any included fonts, which causes Chrome to misbehave and Puppeteer to crash with a cryptic error message—hence the extra installation steps.*

No action is required for the included ZIP file. The dockerfile handles the download, extraction, and installation itself.