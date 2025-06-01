## eepnet

`eepnet` is a tool for spawning ephemeral, mixed-router [I2P](https://geti2p.net/) testnets

### Supported routers
* [official I2P implementation](https://geti2p.net/)
* [i2pd](https://github.com/PurpleI2P/i2pd)
* [emissary](https://github.com/altonen/emissary)

### Usage

The network is specified in a `.toml` file which lists the router kinds, their counts and additional configuration options the routers should be started with. `eepnet` then starts each router, allowing it to generate a router info for itself, shuts down the routers, gathers all router infos, "seeds" them by copying the router info files of other routers into the router's `netDb` directory and starts the routers again.

`emissary` uses [Prometheus](https://prometheus.io/) for its metrics and the scraping endpoints of all routers are exposed to host. Grafana can be used to get visualizations of the network.

Example:
```bash=
# spawn the network
ts-node src/main.ts spawn --path networks/network.toml

# start prometheus
prometheus --config.file resources/prometheus.yml --log.level debug
```

To prevent the simulator from purging simulation data after it exits, allowing reuse of the existing data for another simulation, use the `--no-purge` flag.

To prevent the simulator from rebuilding images, use the `--no-rebuild` flag.

### E2E tests

The simulator can also be used to implement *end-to-end (E2E)* tests and make assertions of router logs and metrics. Log assertions are available for all router kinds but metric assertions are available only for `emissary` See [`tests`]() for more details on how to write an E2E test.

Run a specific test
```bash=
ts-node src/main.ts test --test tests/0001-streaming-works
```

Run all tests sequentially and exit after one of the test fails or after all have been executed successfully:
```bash=
ts-node src/main.ts test
```

Run all test and ignore errors:
```bash=
ts-node src/main.ts test --ignore-errors
```
