
      function doWork() {
        open_file("test");
        console.log("opened");
        assert(fileExists);
        read_file(fd);
        console.log("read done");
        close_file(fd);
      }
    