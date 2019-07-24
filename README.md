# Monster Rancher

A game built on the [tfw platform](https://github.com/tfwdev/platform).

## Building

You'll need the tfw platform project checked out next to this directory. For example:

```
somedir/platform/...
somedir/moncher/...
```

You'll also need the platform project to be built. The rest is the usual business:

```
cd moncher
yarn
yarn start
```

If you're working on platform and moncher, you'll want to `yarn link` in `tfw/lib` and then `yarn
link tfw` in `moncher`. This will make moncher symlink to your platform checkout and use the latest
code from there.

## License

The code is licensed under the MIT License. See the [LICENSE](LICENSE.md) file for details.

The media license is TBD. We'll sort that out once we have media.
