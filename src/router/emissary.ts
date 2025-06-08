// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the "Software"),
// to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense,
// and/or sell copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.

import { create } from "tar";
import { promises as fs } from "fs";
import * as toml from "@iarna/toml";

import { Router, RouterInfo } from "../config";
import { Container, Image } from "../docker";
import { getRouterHash } from "./util";

export class Emissary implements Router {
  name: string;
  log: string;
  floodfill: boolean;
  sam: boolean;
  hash: null | string;
  host: null | string;
  path: null | string;
  container: null | Container;

  constructor(name: string, log: string, floodfill: boolean, sam: boolean) {
    this.name = name;
    this.log = log;
    this.floodfill = floodfill;
    this.sam = sam;

    this.hash = null;
    this.host = null;
    this.path = null;
    this.container = null;
  }

  getName(): string {
    return this.name;
  }

  getRouterHash(): string {
    if (!this.hash) throw new Error("router hash not set");
    return this.hash;
  }

  setHost(host: string): void {
    this.host = host;
  }

  async generateRouterInfo(path: string): Promise<RouterInfo> {
    this.path = path;

    if (!this.host) throw new Error("host not specified");

    let config = toml.stringify({
      floodfill: this.floodfill,
      insecure_tunnels: true,
      allow_local: true,
      caps: this.floodfill ? "XfR" : "LR",
      ntcp2: {
        host: this.host,
        port: 9999,
        publish: true,
      },
      i2cp: {
        port: 7654,
      },
      sam: {
        udp_port: 7655,
        tcp_port: 7656,
        host: "0.0.0.0",
      },
    });

    await fs.writeFile(`${path}/router.toml`, config);
    await fs.mkdir(`${path}/routers`, {
      recursive: true,
    });

    // create new container which starts up a fresh router
    //
    // this router generates itself keys and a router info file which,
    // after waiting for 2 secons for initialization finish, is collected
    // from `this.path` and returned to the caller
    const container = new Container("emissary", this.name, path, this.host);
    await container.create([`${path}:/var/lib/emissary`], {}, {}, [
      "emissary-cli",
      this.log,
      "--base-path",
      "/var/lib/emissary",
      "--disable-reseed",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await container.destroy();

    let routerInfo = new Uint8Array(
      await fs.readFile(`${path}/router.info`),
    );
    this.hash = getRouterHash(routerInfo.subarray(0, 391));

    return { name: this.name, hash: this.hash, info: routerInfo };
  }

  async populateNetDb(routerInfos: RouterInfo[]): Promise<void> {
    // filter out our own router info
    routerInfos
      .filter((info: RouterInfo) => info.name != this.name)
      .map((info: RouterInfo) => info)
      .forEach(
        async (info: RouterInfo) =>
          await fs.writeFile(
            `${this.path}/routers/routerInfo-${info.hash}.dat`,
            info.info,
          ),
      );
  }

  async start(): Promise<void> {
    if (!this.path || !this.host) throw new Error("path or host not set");

    // default port mappings for prometheus
    let ports: { [key: string]: any[] } = {
      ["12842/tcp"]: [{}],
    };
    let exposedPorts: { [key: string]: any } = {
      ["12842/tcp"]: {},
    };

    // if sam was enabled, expose the ports and map them to random host ports
    if (this.sam) {
      ports["7656/tcp"] = [{}];
      exposedPorts["7656/tcp"] = {};

      ports["7655/udp"] = [{}];
      exposedPorts["7655/udp"] = {};
    }

    this.container = new Container("emissary", this.name, this.path, this.host);

    await this.container.create(
      [`${this.path}:/var/lib/emissary`],
      ports,
      exposedPorts,
      ["emissary-cli", this.log, "--base-path", "/var/lib/emissary", "--disable-reseed"],
    );
  }

  async stop(): Promise<void> {
    if (this.container) await this.container.destroy();
  }

  async getScrapeEndpoint(): Promise<any> {
    if (!this.container) throw new Error("container is not running");

    // fetch port mapping for prometheus on host
    let info = await this.container.inspect();

    return {
      targets: [
        `0.0.0.0:${info["NetworkSettings"]["Ports"]["12842/tcp"][0]["HostPort"]}`,
      ],
      labels: {
        router: info["Name"].substring(1),
      },
    };
  }

  async getLogs(): Promise<any> {
    if (!this.container) throw new Error("container doesn't exist");

    return await this.container.logs();
  }
}

export async function buildEmissary() {
  await create(
    {
      gzip: true,
      file: "/tmp/eepnet/emissary.tar",
      cwd: "resources/",
    },
    ["Dockerfile.emissary"],
  );

  await new Image("emissary", "/tmp/eepnet/emissary.tar").build("Dockerfile.emissary");
}
